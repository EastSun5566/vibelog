# VibeLog infrastructure

This Pulumi TypeScript package owns the production stack. Local development uses Docker Compose instead.

## What the stack owns

- Artifact Registry and one immutable application image.
- Public web and private worker Cloud Run services.
- Cloud Tasks, Cloud Scheduler, service accounts, IAM, and Secret Manager.
- A private Cloudflare R2 bucket, edge Worker, DNS, and hostname routes.
- A Neon PostgreSQL project, database, role, and compute endpoint.
- A Resend sending domain and runtime key, plus support email routing.

The stateful foundation resources use Pulumi protection. The stack does not create the GCP project or provider accounts.

## Deployment phases

- `foundation` creates storage, database, image registry, and email foundations without reading application secrets.
- `application` retains the foundation, builds and pushes the image, runs migrations, and creates the runtime and edge delivery.

A new production environment can be created with one application-phase `pulumi up` after the provider accounts, APIs, credentials, and Docker authentication are ready. See [RUNBOOK.md](RUNBOOK.md) for that one-time setup.

## Hostnames

For a `rootDomain` such as `example.org`:

| Purpose | Hostname |
| --- | --- |
| App and login | `example.org` |
| Private preview | `preview.example.org` |
| Published blog | `alice.example.org` |

Cloudflare proxies the apex and wildcard records through separate Worker routes. The edge Worker preserves the requested hostname, signs the origin request, and contains no application domain logic.

## Normal deployment

Build the edge bundle and Pulumi program before previewing:

```sh
pnpm --filter @vibelog/edge build
pnpm --filter @vibelog/infra build
pulumi stack select <organization>/<project>/prod --cwd packages/infra
pulumi preview --cwd packages/infra
```

Review every preview before `pulumi up`. The repository guard rejects protected-resource deletion or replacement, public worker access, and public R2 exposure.

The **Deploy production** GitHub workflow is the normal delivery path. It accepts a manual dispatch from `main`, requires successful CI for that exact commit, performs one guarded update, then checks the public app and private worker transport. Pushing code alone never deploys production.

Do not deploy Cloud Run separately with `gcloud run deploy`; Pulumi must remain the only owner of revision configuration.

## Runtime model

Both Cloud Run services consume the same image digest. A migration gate applies the checked-in Drizzle migrations before either service updates. PostgreSQL operations and leases make retries safe, while a scheduled dispatcher recovers expired or stranded outbox work.

ESC supplies deployment credentials and bootstrap secrets. Pulumi materializes runtime secrets into GCP Secret Manager, so running containers do not depend on ESC or Pulumi Cloud.
