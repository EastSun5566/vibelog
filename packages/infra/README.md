# VibeLog infrastructure

This package provisions the production delivery infrastructure with Pulumi TypeScript.

The Pulumi program manages:

- Artifact Registry and separate public web/private worker Cloud Run services
- Cloud Tasks, Cloud Scheduler, service accounts, IAM, and Secret Manager
- a private Cloudflare R2 bucket, edge Worker, and explicit routes for application, preview, and public-blog hostnames

The R2 bucket, Artifact Registry repository, and Secret Manager secrets are protected resources. The program does not create the GCP project, cloud-provider accounts, PostgreSQL database, email account, or OAuth applications.

## Configuration

Use one cloud `prod` stack and local Compose for development. Set the target GCP project and region in `Pulumi.prod.yaml`:

```yaml
config:
  gcp:project: <gcp-project-id>
  vibelog:deploymentPhase: foundation
  vibelog:environment: prod
  vibelog:gcpRegion: <gcp-region>
  vibelog:cloudflareAccountId: <cloudflare-account-id>
  vibelog:minInstances: 0
  vibelog:maxInstances: 3
  vibelog:r2Location: apac
environment:
  - <esc-project>/prod
```

Required non-secret `vibelog:` configuration:

- `deploymentPhase`: exactly `foundation` or `application`
- `environment`, `gcpRegion`, and `cloudflareAccountId`
- application only: `rootDomain`, `cloudflareZoneId`, and `imageDigest`
- application only: `githubClientId`, `googleClientId`, `emailFrom`, and `emailReplyTo`

Required secret `vibelog:` configuration, normally supplied through Pulumi ESC:

- `cloudflareR2ApiToken` for the foundation R2 provider
- application only: `databaseUrl`, `objectStoreAccessKeyId`, `objectStoreSecretAccessKey`, `resendApiKey`, `betterAuthSecret`, OAuth client secrets, `aiApiKey`, `edgeSharedSecret`, and `cloudflareDeliveryApiToken`

The deployment environment must also expose:

- `GOOGLE_OAUTH_ACCESS_TOKEN`: a short-lived GCP token used by Pulumi and Artifact Registry
- `DATABASE_MIGRATION_URL`: the direct PostgreSQL URL used by migration and the isolated deployment smoke fixture

`DATABASE_MIGRATION_URL` is deliberately not passed to Cloud Run. Pulumi materializes runtime secrets into GCP Secret Manager, and Cloud Run receives only native secret references.

Keep the R2 administrative token, Worker/DNS delivery token, and bucket-scoped object-store credentials separate. Never expose them as non-secret stack outputs.

The foundation token needs only the account-scoped `Workers R2 Storage Write` permission for the intended Cloudflare account. Create it as a dedicated custom API token rather than reusing Wrangler's user OAuth credential.

The `foundation` phase always manages the protected Artifact Registry repository and private R2 bucket without evaluating application configuration. The `application` phase retains those same resources and adds the runtime and delivery components. GCP service APIs are owner-operated prerequisites; the deployment service account is not granted Service Usage Admin.

The application phase expects the bootstrap identity to be `vibelog-deployer@<gcp-project-id>.iam.gserviceaccount.com`. Pulumi grants that identity `roles/iam.serviceAccountUser` only on the three service accounts it creates for web, worker, and task invocation. Web and worker receive `roles/cloudtasks.enqueuer` only on the application operation queue; the stack does not create project-wide bindings for either permission.

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

The first deployment requires one-time bootstrap authority for Pulumi Cloud OIDC, ESC dynamic GCP credentials, and external service credentials. GitHub authenticates to Pulumi Cloud; ESC supplies the short-lived GCP credentials. This stack does not provision a second GitHub-to-GCP workload identity or deployment service account. Artifact Registry must exist before CI can push the first application image, so bootstrap that protected repository first, push an immutable image, and then deploy the complete stack.

Before the first deployment, complete these gates in order:

1. Create a fresh GCP project and link the existing billing account. Recreating a project does not restart Free Trial credits or extend the trial. Do not upgrade or close the account as part of project replacement.
2. Create the empty Pulumi `prod` stack and ESC `prod` environment. Configure the ESC GCP identity and narrowly scoped deployment permissions; no runtime service needs ESC credentials.
3. Enable the explicitly approved GCP APIs with the project owner account. Do not grant Service Usage Admin to the deployment service account.
4. Set `deploymentPhase: foundation`, add the purpose-specific R2 management token through encrypted ESC configuration, and preview the allowlisted foundation graph. Pulumi creates and owns the protected Artifact Registry repository and private R2 bucket from their first update; Wrangler is only used for inspection and remote object smoke tests.
5. Create Object Read & Write credentials scoped to `vibelog-prod-artifacts`, store them in ESC, and verify them with the application's S3 integration test. Do not reuse the R2 management token as runtime credentials.
6. Finish domain registration and collect the Cloudflare zone ID. Supply the Neon pooled/direct URLs, delivery token, Resend sender credentials, OAuth client credentials, and AI key through encrypted ESC inputs. Do not paste secrets into workflow YAML or commit them.
7. Change `deploymentPhase` to `application`, push a newly built immutable image, and review the complete preview. The old `0.7.0` release predates the stateless entrypoints and cannot bootstrap this stack. On the first application deployment there is no previous serving revision, so the candidate cannot be isolated at zero traffic.
8. Verify apex login, real OAuth/email delivery, preview, sync, publish, and a public author page over HTTPS. The workflow's apex `/health` smoke alone does not verify preview or wildcard author TLS.

External service credentials and the ESC identity are prerequisites, not resources this application stack creates. An empty stack or environment is not a completed bootstrap.

The ESC deployment identity also needs `cloudtasks.tasks.create` and `cloudtasks.tasks.delete` on the operation queue, plus `iam.serviceAccounts.actAs` on the task-invoker service account for worker smoke tests. Grant these during bootstrap with the rest of the deployment identity permissions; do not grant them to public callers. If an older stack has already provisioned the removed GitHub identity resources, retire those explicitly after reviewing their users. The normal preview guard still blocks deletes.

Normal deployments use one immutable application image for both Cloud Run services, run PostgreSQL migrations separately with the direct URL, stage candidate revisions without traffic, smoke-test the candidate, and then promote it.

The worker smoke sends a real Cloud Task to the candidate-tag URL, keeping the stable worker URL as its OIDC audience. An isolated invalid-theme operation must be claimed exactly once and persisted as failed, exercising authentication and database execution without contacting an AI or content provider. The task and database fixture are removed afterwards. A timeout or failure blocks promotion; this is a deployment transport smoke, not a replacement for full local E2E.

## Interrupted operations

An active operation lease returns a retryable HTTP response, not a successful duplicate acknowledgement. Delivery retries outlive the 35-minute lease; PostgreSQL still limits execution to three claims. The scheduled outbox dispatcher reopens expired or stranded operations with a new delivery identity, so a previously completed task name cannot suppress recovery. Completion, failure and progress writes require the matching live attempt, preventing an old worker from overwriting a newer claim. Artifact pruning runs separately in maintenance.
