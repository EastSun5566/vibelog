# Production bootstrap runbook

Use this runbook only when creating or repairing the production stack. Normal releases use the manual **Deploy production** GitHub workflow described in [README.md](README.md).

## Prerequisites

- A GCP project with billing and required service APIs enabled.
- Cloudflare, Neon, Resend, and Pulumi Cloud accounts.
- The Pulumi `prod` stack and matching ESC environment.
- A running Docker daemon authenticated to the configured public GHCR repository with package write access.
- The short-lived GCP deployment identity described below.

The stack creates application infrastructure, but it does not create provider accounts, the GCP project, or its billing relationship.

## Stack configuration

Keep public identifiers in `Pulumi.prod.yaml`:

```yaml
config:
  gcp:project: <gcp-project-id>
  vibelog:deploymentPhase: foundation
  vibelog:environment: prod
  vibelog:containerImageRepository: ghcr.io/<owner>/<image>
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

`containerImageRepository` is required only in application mode and must name a public GHCR package without a tag. Optional application settings are `aiProvider`, `aiModel`, `aiFallbackModels`, `aiApiKeyEnv`, `googleAnalyticsMeasurementId`, and `neonProjectName`. Fallback models use the same provider and API key as the primary model. The Neon project name defaults to `vibelog-<environment>`.

Store these secret `vibelog:` values in ESC:

- `cloudflareR2ApiToken`
- `cloudflareDeliveryApiToken`
- `neonApiKey`
- `resendManagementApiKey`
- `supportForwardingDestination`
- `objectStoreAccessKeyId`
- `objectStoreSecretAccessKey`
- `betterAuthSecret`
- `aiApiKey`
- `edgeSharedSecret`

For production deployments, also set the non-secret ESC value `vibelog:maintenanceStage` to `normal`, `draining`, or `locked`. Self-hosted instances default to `normal`. The deployment workflow requires an explicit production value and reports the stage applied by Pulumi.

The environment must also expose the short-lived `GOOGLE_OAUTH_ACCESS_TOKEN`. Never put credentials in the repository or non-secret stack outputs.

Use separate Cloudflare credentials for R2 administration, Worker and DNS delivery, and bucket-scoped application object access. Pulumi creates a sending-only Resend runtime key and injects it into Cloud Run; do not copy that runtime key into ESC.

Keep each credential narrowly scoped:

- R2 management: account-level Workers R2 Storage Write.
- Delivery: Workers Scripts Write on the account; DNS Write, Workers Routes Write, Email Routing Addresses and Rules Read/Write, and Zone Settings Read/Write on the zone.
- Application storage: Object Read & Write on the production bucket only.

## Deployment identity

The bootstrap identity is `vibelog-deployer@<gcp-project-id>.iam.gserviceaccount.com`.

Normal deployments use resource-level roles created by the stack. The first application update temporarily requires project-level `roles/iam.serviceAccountAdmin` because the runtime service accounts do not exist yet. Remove that project role immediately after Pulumi creates the service accounts and their scoped bindings.

The deployment smoke also needs permission to create and delete tasks on the operation queue and to act as the task-invoker service account. Public callers never receive these permissions.

## First deployment

1. Enable the required GCP service APIs with a project owner. Do not grant Service Usage Admin to the deployer.
2. Configure ESC workload identity and the provider credentials above.
3. Set `deploymentPhase: foundation`, run preview, and apply the protected R2, Neon, Resend, and email-routing resources. The program can create everything from `application`, but this gate makes first-time credential and DNS failures easier to isolate.
4. Create Object Read & Write credentials scoped to the production R2 bucket, save them in ESC, and run the S3 integration test.
5. Approve Cloudflare's forwarding-destination email. Confirm Resend domain verification and Email Routing readiness.
6. Add the application secrets, set `deploymentPhase: application`, and review the complete preview.
7. Grant the temporary first-update IAM role, run one `pulumi up`, verify the scoped bindings, then remove the temporary role.
8. Verify magic-link login, support forwarding, sync, preview, publish, rollback, and a wildcard author hostname over HTTPS.

The image resource builds from the checked-out source and pushes to public GHCR. Cloud Run and the migration gate consume its immutable digest even though the registry upload tag is mutable.

## Failure and recovery rules

- Never bypass Pulumi to update Cloud Run, DNS, R2, Neon, or Resend resources it owns.
- Never approve a preview that deletes or replaces a protected stateful resource without an explicit recovery plan.
- An active operation lease must remain retryable. Delivery retries outlive the lease, while PostgreSQL limits execution attempts.
- Completion, failure, and progress writes require the current attempt identity so an old worker cannot overwrite a newer claim.
- The worker smoke intentionally executes one invalid-theme fixture through Cloud Tasks and removes the task and database fixture afterward. It does not replace the full local E2E suite.

## Maintenance window

Use the same **Deploy production** workflow and exact main commit for each stage change. Review the Pulumi preview at every step. The workflow allows `normal → draining → locked → normal` and safe retries of the current stage; it rejects other transitions.

1. Set `vibelog:maintenanceStage` to `draining` in prod ESC, then deploy. Public entry points and the direct web URL return uncached 503 except `/health`. The worker continues queued work; daily cleanup pauses while outbox recovery stays active.
2. Wait for old web requests to end. Confirm there are no queued or running operations, pending outbox rows, Cloud Tasks tasks, or in-flight worker requests. The deployment checks the first two database counts. **Cloud Tasks and in-flight requests must be checked independently** before selecting `confirmDrained` on the next workflow run.
3. Set the stage to `locked`, select `confirmDrained`, and deploy the same application commit. Both Scheduler jobs pause, and new worker requests return uncached 503. Verify both Cloud Run revisions are ready and `/health` works. Keep the site locked while backing up and changing incompatible data.
4. After the migration and new application revision are verified, set the stage to `normal`, select `confirmResume`, and deploy. Confirm web, edge, private worker smoke, and both Scheduler jobs. A locked deployment intentionally skips worker smoke until this step.

Do not unlock simply because the deployment succeeded. Before an irreversible data conversion, test a database backup restore on an isolated copy and record its recovery point. After conversion commits, do not roll back only the runtime image to a version that cannot read the new data.

### Presentation IR v2 cutover

Deploy the V1-compatible maintenance guardrails to `main` while the stage is `normal`. Update and verify the V2 PR on that base. Then enter `draining` and `locked` using the V1 commit as described above. Take a restorable database backup, rehearse the conversion against an isolated copy of production data, and record the read-only V1 revision count. Leave existing R2 drafts in place.

Only after the site is locked, merge the V2 PR and wait for CI on its exact main SHA. Run **Run production data migration** with `design-v2`, the recorded revision count, and `backupConfirmed`. That workflow audits before conversion and requires zero V1 revisions and preview sessions afterward. If it fails, remain locked, audit again, and investigate before retrying. The V2 deployment workflow rejects unconverted V1 data before Pulumi preview. Its first V2 deployment also requires the existing stack stage and target stage to be `locked`.

Deploy the V2 SHA while locked, verify ready web and worker revisions and health, then return to `normal` using `confirmResume`. Verify login, editor history, private previews, a public article, worker smoke, and resumed Scheduler jobs before ending the window. Once conversion commits, never roll back only to a V1 image; restore the tested DB backup and V1 runtime together only while writes are still closed. After reopening, repair V2 forward so new writes are not lost.
