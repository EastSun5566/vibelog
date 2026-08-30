# VibeLog infrastructure

This package provisions the production delivery infrastructure with Pulumi TypeScript.

The Pulumi program manages:

- Artifact Registry and separate public web/private worker Cloud Run services
- Cloud Tasks, Cloud Scheduler, service accounts, IAM, and Secret Manager
- a private Cloudflare R2 bucket, edge Worker, and explicit routes for application, preview, and public-blog hostnames

The R2 bucket, Artifact Registry repository, and Secret Manager secrets are protected resources. The program does not create the GCP project, cloud-provider accounts, PostgreSQL database, email account, or OAuth applications.

## Configuration

Set the target GCP project and region in the stack configuration:

```yaml
config:
  gcp:project: <gcp-project-id>
  gcp:region: <gcp-region>
  vibelog:environment: <environment-name>
  vibelog:minInstances: 0
  vibelog:maxInstances: 3
  vibelog:r2Location: apac
environment:
  - <pulumi-organization>/<esc-project>/<esc-environment>
```

Required non-secret `vibelog:` configuration:

- `rootDomain`, `cloudflareAccountId`, and `cloudflareZoneId`
- `imageDigest`
- `githubClientId` and `googleClientId`
- `emailFrom` and `emailReplyTo`

Required secret `vibelog:` configuration, normally supplied through Pulumi ESC:

- `databaseUrl` (the pooled PostgreSQL runtime URL)
- `objectStoreAccessKeyId` and `objectStoreSecretAccessKey`
- `resendApiKey` and `betterAuthSecret`
- `githubClientSecret` and `googleClientSecret`
- `aiApiKey` and `edgeSharedSecret`
- `cloudflareApiToken` for the Pulumi provider

The deployment environment must also expose:

- `GOOGLE_OAUTH_ACCESS_TOKEN`: a short-lived GCP token used by Pulumi and Artifact Registry
- `DATABASE_MIGRATION_URL`: the direct PostgreSQL URL used by migration and the isolated deployment smoke fixture

`DATABASE_MIGRATION_URL` is deliberately not passed to Cloud Run. Pulumi materializes runtime secrets into GCP Secret Manager, and Cloud Run receives only native secret references.

Keep the Cloudflare administrative token separate from the bucket-scoped object-store credentials used by the application. Never expose either token as a non-secret stack output.

## Edge delivery

The edge package is the Cloudflare-specific delivery adapter for the current production topology. It preserves the requested hostname, signs the request, and proxies it to the public web service. It does not contain application domain logic and does not access R2 directly.

Local development does not require the edge Worker. Local wildcard hostnames resolve directly to the Node.js web service, and the application accepts requests without edge identity headers when `EDGE_SHARED_SECRET` is not configured.

The edge bundle must already exist at `packages/edge/dist/index.js`; Pulumi does not run build commands during preview or update.

## Preview and deployment

Build the edge bundle and Pulumi program before invoking Pulumi:

```sh
pnpm --filter @vibelog/edge build
pnpm --filter @vibelog/infra build
pulumi stack select <organization>/<project>/<stack>
pulumi preview --cwd packages/infra
```

Review every preview before running `pulumi up`. The repository's preview guard rejects deletes, replacement of protected stateful resources, public worker access, and public R2 exposure.

The first deployment requires one-time bootstrap authority for Pulumi Cloud OIDC, ESC dynamic GCP credentials, and external service credentials. GitHub authenticates to Pulumi Cloud; ESC supplies the short-lived GCP credentials. This stack does not provision a second GitHub-to-GCP workload identity or deployment service account. Artifact Registry must exist before CI can push the first application image, so bootstrap that protected repository first, push an immutable image, and then deploy the complete stack.

The ESC deployment identity also needs `cloudtasks.tasks.create` and `cloudtasks.tasks.delete` on the operation queue, plus `iam.serviceAccounts.actAs` on the task-invoker service account for worker smoke tests. Grant these during bootstrap with the rest of the deployment identity permissions; do not grant them to public callers. If an older stack has already provisioned the removed GitHub identity resources, retire those explicitly after reviewing their users. The normal preview guard still blocks deletes.

Normal deployments use one immutable application image for both Cloud Run services, run PostgreSQL migrations separately with the direct URL, stage candidate revisions without traffic, smoke-test the candidate, and then promote it.

The worker smoke sends a real Cloud Task to the candidate-tag URL, keeping the stable worker URL as its OIDC audience. An isolated invalid-theme operation must be claimed exactly once and persisted as failed, exercising authentication and database execution without contacting an AI or content provider. The task and database fixture are removed afterwards. A timeout or failure blocks promotion; this is a deployment transport smoke, not a replacement for full local E2E.

## Interrupted operations

An active operation lease returns a retryable HTTP response, not a successful duplicate acknowledgement. Delivery retries outlive the 35-minute lease; PostgreSQL still limits execution to three claims. The scheduled outbox dispatcher reopens expired or stranded operations with a new delivery identity, so a previously completed task name cannot suppress recovery. Completion, failure and progress writes require the matching live attempt, preventing an old worker from overwriting a newer claim. Artifact pruning runs separately in maintenance.
