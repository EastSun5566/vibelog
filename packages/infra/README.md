# VibeLog infrastructure

This package provisions the production delivery infrastructure with Pulumi TypeScript.

The Pulumi program manages:

- Artifact Registry, a Pulumi-built immutable application image, and separate public web/private worker Cloud Run services
- Cloud Tasks, Cloud Scheduler, service accounts, IAM, and Secret Manager
- a private Cloudflare R2 bucket, edge Worker, and explicit routes for application, preview, and public-blog hostnames
- a Neon PostgreSQL project and its default branch, database, role, and compute endpoint
- a Resend sending domain and domain-scoped runtime key, plus Cloudflare Email Routing for support mail

The R2 bucket, Artifact Registry repository, Neon project, Resend domain, and Secret Manager secrets are protected resources. The program does not create the GCP project or cloud-provider accounts.

## Configuration

Use one cloud `prod` stack and local Compose for development. Set the target GCP project and region in `Pulumi.prod.yaml`:

```yaml
config:
  gcp:project: <gcp-project-id>
  vibelog:deploymentPhase: foundation
  vibelog:environment: prod
  vibelog:gcpRegion: <gcp-region>
  vibelog:cloudflareAccountId: <cloudflare-account-id>
  vibelog:cloudflareZoneId: <cloudflare-zone-id>
  vibelog:rootDomain: example.org
  vibelog:neonOrgId: <neon-organization-id>
  vibelog:neonRegionId: aws-ap-southeast-1
  vibelog:minInstances: 0
  vibelog:maxInstances: 3
  vibelog:r2Location: apac
environment:
  - <esc-project>/prod
```

Required non-secret `vibelog:` configuration:

- `deploymentPhase`: exactly `foundation` or `application`
- `environment`, `gcpRegion`, `cloudflareAccountId`, `neonOrgId`, and `neonRegionId`
- `rootDomain` and `cloudflareZoneId`
- optional `neonProjectName`; defaults to `vibelog-<environment>`
- optional application AI settings: `aiProvider`, `aiModel`, and `aiApiKeyEnv`

Required secret `vibelog:` configuration, normally supplied through Pulumi ESC:

- `cloudflareR2ApiToken` for the foundation R2 provider
- `neonApiKey` for the Neon provider
- `cloudflareDeliveryApiToken` for Resend DNS, Email Routing, Workers, routes, and application DNS
- `resendManagementApiKey` for stack-managed Resend domain and runtime-key lifecycle
- `supportForwardingDestination`, which remains secret even though Cloudflare must receive it
- application only: `objectStoreAccessKeyId`, `objectStoreSecretAccessKey`, `betterAuthSecret`, `aiApiKey`, and `edgeSharedSecret`

The deployment environment must also expose:

- `GOOGLE_OAUTH_ACCESS_TOKEN`: a short-lived GCP token used by Pulumi and Artifact Registry

Pulumi derives both PostgreSQL URLs from the managed Neon project. The pooled URL is materialized into GCP Secret Manager for Cloud Run. The direct URL remains a secret Pulumi output and is used by the migration gate and isolated deployment smoke fixture; it is never passed to Cloud Run.

Keep the R2 administrative token, Worker/DNS delivery token, and bucket-scoped object-store credentials separate. Never expose them as non-secret stack outputs.

The Resend management key is a bootstrap credential. Pulumi uses it to create and verify `send.<rootDomain>` and to create a `sending_access` runtime key scoped to that exact domain. The runtime token is returned once, marked as a Pulumi secret output, and injected into Cloud Run without being copied to ESC or stack configuration. Resend DNS records are created unproxied from the exact API response; the program does not synthesize DKIM or regional MX values.

The R2 token needs only the account-scoped `Workers R2 Storage Write` permission for the intended Cloudflare account. The delivery token needs Workers Scripts Write for the account, DNS Write and Workers Routes Write for the zone, Email Routing Addresses/Rules Read and Write, and Zone Settings Read and Write. Create both as dedicated custom API tokens rather than reusing Wrangler's user OAuth credential.

The `foundation` phase always manages the protected Artifact Registry repository, private R2 bucket, Neon database, Resend domain/runtime key, and Cloudflare Email Routing foundation without evaluating application secrets. The `application` phase retains those same resources, builds and pushes the application image after Artifact Registry exists, applies checked-in Drizzle migrations, and then adds the runtime, support forwarding rule, and edge delivery components. A fresh application stack can therefore create storage, database, email delivery, image, schema, runtime, and edge delivery in one `pulumi up`. GCP service APIs, a running Docker daemon, and registry authentication are operator prerequisites; the deployment service account is not granted Service Usage Admin.

The application phase expects the bootstrap identity to be `vibelog-deployer@<gcp-project-id>.iam.gserviceaccount.com`. Pulumi grants that identity `roles/iam.serviceAccountAdmin` and `roles/iam.serviceAccountUser` only on the three service accounts it creates for web, worker, and task invocation. The admin role lets later updates manage those exact identities; the user role lets Cloud Run and Scheduler attach them. Web and worker receive `roles/cloudtasks.enqueuer` only on the application operation queue.

The first application update temporarily needs project-level `roles/iam.serviceAccountAdmin` because the three service accounts and their resource-level policies do not exist yet. After that update succeeds and the exact resource-level bindings are verified, the project owner must remove the project-level role. Normal deployments must not retain project-wide Service Account Admin or Service Account User. Recreating a deleted runtime service account requires repeating this explicit bootstrap gate.

## Edge delivery

`rootDomain` must be the apex of the dedicated Cloudflare zone for the intended free Universal SSL setup. With `rootDomain: example.org`, the application uses:

| Purpose | Hostname |
| --- | --- |
| App, login, OAuth callbacks | `example.org` |
| Isolated preview | `preview.example.org` |
| Published author blog | `alice.example.org` |

Pulumi creates proxied DNS records for the apex and `*`, with separate Worker routes `example.org/*` and `*.example.org/*`. It does not create `app.example.org` or `*.app.example.org`. Cloudflare's [Universal SSL coverage](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/) includes the apex and first-level subdomains in a full zone; wait for zone and certificate activation before opening traffic. This topology does not require Advanced Certificate Manager. Registration alone does not deploy the Worker or the application.

The edge package is the Cloudflare-specific delivery adapter for the current production topology. It preserves the requested hostname, signs the request, and proxies it to the public web service. It does not contain application domain logic and does not access R2 directly.

Local development does not require the edge Worker. Local wildcard hostnames resolve directly to the Node.js web service, and the application accepts requests without edge identity headers when `EDGE_SHARED_SECRET` is not configured.

The edge bundle must already exist at `packages/edge/dist/index.js`; Pulumi does not run build commands during preview or update.

## Preview and deployment

Build the edge bundle and Pulumi program before invoking Pulumi:

```sh
pnpm --filter @vibelog/edge build
pnpm --filter @vibelog/infra build
pulumi stack select <organization>/<project>/prod --cwd packages/infra
pulumi preview --cwd packages/infra
```

Review every preview before running `pulumi up`. The repository's preview guard rejects deletes, replacement of protected stateful resources, public worker access, and public R2 exposure. Pass `foundation` as its second argument during bootstrap so it also rejects every resource outside the foundation graph.

The **Deploy production** workflow only accepts manual dispatches on `main`. Before loading deployment credentials, it checks that the latest CI push run for the selected commit completed successfully. Missing, running, failed, or cancelled CI blocks deployment. The GitHub environment is `production`; configure its protection rules and restrict Pulumi Cloud OIDC trust to the intended repository/environment during bootstrap. No push or CI completion automatically deploys production.

The first deployment requires one-time bootstrap authority for Pulumi Cloud OIDC, ESC dynamic GCP credentials, external service credentials, and a Docker daemon authenticated to `<region>-docker.pkg.dev`. GitHub authenticates to Pulumi Cloud; ESC supplies the short-lived GCP credentials. This stack does not provision a second GitHub-to-GCP workload identity or deployment service account. The Pulumi image resource depends on Artifact Registry, so the application phase can create the repository and then build and push the first image in the same update.

Before the first deployment, complete these gates in order:

1. Create a fresh GCP project and link the existing billing account. Recreating a project does not restart Free Trial credits or extend the trial. Do not upgrade or close the account as part of project replacement.
2. Create the empty Pulumi `prod` stack and ESC `prod` environment. Configure the ESC GCP identity and narrowly scoped deployment permissions; no runtime service needs ESC credentials.
3. Enable the explicitly approved GCP APIs with the project owner account. Do not grant Service Usage Admin to the deployment service account.
4. Set `deploymentPhase: foundation`; add the purpose-specific R2, Cloudflare delivery, Neon, and Resend management tokens plus the forwarding destination through encrypted ESC configuration; then preview the allowlisted foundation graph. Pulumi creates and owns the protected Artifact Registry repository, private R2 bucket, Neon project, Resend domain/key, and Email Routing foundation from their first update. Wrangler and Neon CLI are only used for inspection and smoke tests.
5. Create Object Read & Write credentials scoped to `vibelog-prod-artifacts`, store them in ESC, and verify them with the application's S3 integration test. Do not reuse the R2 management token as runtime credentials.
6. Click the Cloudflare destination verification email. Confirm that the Resend domain is verified and Email Routing is ready before creating the forwarding rule.
7. Supply Better Auth, edge, and AI secrets through encrypted ESC inputs, change `deploymentPhase` to `application`, and review the complete preview. The Pulumi update builds the checked-out source, pushes it under the stack-managed tag, and passes the resulting digest-pinned reference to migrations and Cloud Run. On the first application deployment there is no previous serving revision, so the candidate cannot be isolated at zero traffic.
8. Verify apex magic-link login, support forwarding, preview, sync, publish, and a public author page over HTTPS. First use `delivered@resend.dev` for delivery acceptance, then a controlled real inbox for the clickable end-to-end login. The workflow's apex `/health` smoke alone does not verify preview or wildcard author TLS.

Cloud account credentials and the ESC identity are prerequisites, not resources this application stack creates. The Neon project itself is stack-owned. An empty stack or environment is not a completed bootstrap.

The ESC deployment identity also needs `cloudtasks.tasks.create` and `cloudtasks.tasks.delete` on the operation queue, plus `iam.serviceAccounts.actAs` on the task-invoker service account for worker smoke tests. Grant these during bootstrap with the rest of the deployment identity permissions; do not grant them to public callers. If an older stack has already provisioned the removed GitHub identity resources, retire those explicitly after reviewing their users. The normal preview guard still blocks deletes.

Normal deployments use one Pulumi-managed image resource for both Cloud Run services. Its registry tag is mutable, but Cloud Run and the migration trigger receive the immutable `tag@sha256:digest` output. The Pulumi migration resource runs the checked-in Drizzle migrations with the managed direct URL before either Cloud Run service can update. The workflow then stages candidate revisions without traffic, smoke-tests the candidate, and promotes it.

The worker smoke sends a real Cloud Task to the candidate-tag URL, keeping the stable worker URL as its OIDC audience. An isolated invalid-theme operation must be claimed exactly once and persisted as failed, exercising authentication and database execution without contacting an AI or content provider. The task and database fixture are removed afterwards. A timeout or failure blocks promotion; this is a deployment transport smoke, not a replacement for full local E2E.

## Interrupted operations

An active operation lease returns a retryable HTTP response, not a successful duplicate acknowledgement. Delivery retries outlive the 35-minute lease; PostgreSQL still limits execution to three claims. The scheduled outbox dispatcher reopens expired or stranded operations with a new delivery identity, so a previously completed task name cannot suppress recovery. Completion, failure and progress writes require the matching live attempt, preventing an old worker from overwriting a newer claim. Artifact pruning runs separately in maintenance.
