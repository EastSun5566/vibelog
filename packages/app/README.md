# VibeLog application

This package builds two HTTP entrypoints from the same production image:

- `dist/web-main.js`: public management app, authentication, previews, and published artifact serving
- `dist/worker-main.js`: private operation, outbox-dispatch, and maintenance endpoints

Both processes use `PORT`, handle `SIGTERM`, and keep no durable state in the container filesystem. Runtime queries use the pooled `DATABASE_URL`; only `dist/migrate.js` reads `DATABASE_MIGRATION_URL`.

The same immutable image contains the web, worker, and migration entrypoints; deployments select the role by overriding the command. PostgreSQL and S3-compatible object storage remain external services and are never embedded in the image.

Provider-neutral ports are under `src/ports`, and concrete integrations are under `src/adapters`. The composition root is `src/runtime-dependencies.ts`.

Authentication supports GitHub, Google, and magic links. Production and self-hosting use Resend; local Compose uses Mailpit so the complete sign-in path works without sending real email. A user chooses a separate public blog handle during onboarding; passwords and username-based authentication are intentionally unsupported.

Queue modes are deliberately small:

- `direct`: in-process execution for `pnpm dev` only
- `postgres`: a separate worker consumes the transactional outbox for Compose/self-host deployments
- `cloud-tasks`: Cloud Tasks pushes operation IDs to the private worker in the managed-cloud deployment

Both durable modes use the same operation lease and idempotency rules. Redis is not required.

See the repository [`.env.example`](../../.env.example) for configuration.
