# VibeLog

VibeLog turns HackMD content into a production-ready, AI-styled blog. This repository is a pnpm monorepo containing the core builder, the web and worker containers, a Cloudflare edge Worker, and Pulumi infrastructure.

## Architecture

The application keeps provider-specific code at its external I/O boundaries:

- PostgreSQL through `pg` and Drizzle (`DATABASE_URL` for runtime, `DATABASE_MIGRATION_URL` for migrations)
- S3-compatible object storage through `ArtifactStore` (R2 in production, MinIO locally)
- Cloud Tasks through `OperationQueue` (PostgreSQL outbox worker for Compose)
- Resend or local Mailpit through `TransactionalEmailSender`
- Cloud Run through two ordinary Node.js HTTP containers

The web process accepts user traffic and enqueues operations. The private worker executes an operation by ID and is safe under duplicate delivery. PostgreSQL is the source of truth for operations, the transactional outbox, artifact state, and the active release. Containers do not contain persistent application state.

## Local full-stack environment

Requirements: Node.js 24, pnpm 10, and Docker. On a new machine, install the E2E browser once with `pnpm exec playwright install chromium`.

```sh
cp .env.example .env
pnpm install
docker compose up --build
```

The app is available at `http://app.localtest.me:3000`; Mailpit captures local sign-in email at `http://localhost:8025`. PostgreSQL and MinIO data persist in Docker volumes; deleting and recreating the web or worker container does not delete application data.

This Compose file is intended for local development, integration tests, and container smoke tests. It uses local credentials and development hostnames; the web and worker are separate processes, with PostgreSQL providing durable operation delivery.

Useful commands:

```sh
pnpm dev
pnpm db:migrate
pnpm check
pnpm test:e2e # isolated Compose stack: login, sync, preview, publish, public site
```

`pnpm test:e2e` creates and removes its own PostgreSQL, MinIO, Mailpit, web, worker, and deterministic HackMD fixture. It exercises the real application boundaries without calling external services. This is a clean PostgreSQL baseline; SQLite data and migrations are intentionally not imported.

## Container image

The production build publishes one application image containing three entrypoints:

- `node dist/web-main.js` (the default command)
- `node dist/worker-main.js`
- `node dist/migrate.js`

The image deliberately does not bundle PostgreSQL, object storage, or an edge proxy.

## Self-hosting on a VPS

[`compose.selfhost.yml`](compose.selfhost.yml) runs the released image as separate migration, web, and durable PostgreSQL-backed worker roles. It also includes private PostgreSQL and MinIO services with persistent volumes. Copy [`.env.selfhost.example`](.env.selfhost.example) to `.env.selfhost`, replace every placeholder, pin `VIBELOG_IMAGE` to an immutable release, then run:

```sh
docker compose --env-file .env.selfhost -f compose.selfhost.yml pull
docker compose --env-file .env.selfhost -f compose.selfhost.yml up -d
docker compose --env-file .env.selfhost -f compose.selfhost.yml ps
```

Only the web port binds to `127.0.0.1`; PostgreSQL, MinIO, and the worker stay private. Put your existing reverse proxy in front of that port with wildcard TLS, preserve the original `Host`, and route `APP_ORIGIN`, `PREVIEW_ORIGIN`, and every `*.<APP_ORIGIN hostname>` request to it. Cloudflare Worker/Pulumi infrastructure is not required for self-hosting.

Back up both named volumes and `.env.selfhost` before upgrades. The manifest is a simple single-VPS topology, not a high-availability database or object-storage setup.

## Deployment

Infrastructure lives in [`packages/infra`](packages/infra/README.md) and is owned by Pulumi. There is one cloud `prod` stack; development runs locally. The **Deploy production** workflow is manually dispatched on `main` and requires CI to have passed for that exact commit. It builds one immutable image for both Cloud Run services, runs migrations with the direct PostgreSQL URL, then deploys the image digest. Pushing code does not automatically deploy. Do not deploy Cloud Run separately with `gcloud run deploy`, because that creates two owners for the same revision configuration.

Pulumi ESC supplies deployment credentials and external SaaS secrets. Pulumi materializes runtime secrets into GCP Secret Manager; the application does not depend on Pulumi or ESC at runtime.
