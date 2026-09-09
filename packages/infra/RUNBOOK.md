# Production bootstrap runbook

Use this runbook only when creating or repairing the production stack. Normal releases use the manual **Deploy production** GitHub workflow described in [README.md](README.md).

## Prerequisites

- A GCP project with billing and required service APIs enabled.
- Cloudflare, Neon, Resend, and Pulumi Cloud accounts.
- The Pulumi `prod` stack and matching ESC environment.
- A running Docker daemon authenticated to `<region>-docker.pkg.dev`.
- The short-lived GCP deployment identity described below.

The stack creates application infrastructure, but it does not create provider accounts, the GCP project, or its billing relationship.

## Stack configuration

Keep public identifiers in `Pulumi.prod.yaml`:

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

Optional application settings are `aiProvider`, `aiModel`, `aiApiKeyEnv`, and `neonProjectName`. The Neon project name defaults to `vibelog-<environment>`.

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
3. Set `deploymentPhase: foundation`, run preview, and apply the protected Artifact Registry, R2, Neon, Resend, and email-routing resources. The program can create everything from `application`, but this gate makes first-time credential and DNS failures easier to isolate.
4. Create Object Read & Write credentials scoped to the production R2 bucket, save them in ESC, and run the S3 integration test.
5. Approve Cloudflare's forwarding-destination email. Confirm Resend domain verification and Email Routing readiness.
6. Add the application secrets, set `deploymentPhase: application`, and review the complete preview.
7. Grant the temporary first-update IAM role, run one `pulumi up`, verify the scoped bindings, then remove the temporary role.
8. Verify magic-link login, support forwarding, sync, preview, publish, rollback, and a wildcard author hostname over HTTPS.

The image resource builds from the checked-out source after Artifact Registry exists. Cloud Run and the migration gate consume its immutable digest even though the registry upload tag is mutable.

## Failure and recovery rules

- Never bypass Pulumi to update Cloud Run, DNS, R2, Neon, or Resend resources it owns.
- Never approve a preview that deletes or replaces a protected stateful resource without an explicit recovery plan.
- An active operation lease must remain retryable. Delivery retries outlive the lease, while PostgreSQL limits execution attempts.
- Completion, failure, and progress writes require the current attempt identity so an old worker cannot overwrite a newer claim.
- The worker smoke intentionally executes one invalid-theme fixture through Cloud Tasks and removes the task and database fixture afterward. It does not replace the full local E2E suite.
