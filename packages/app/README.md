# VibeLog application

This package builds the management app and its background worker from one image.

## Entrypoints

- `dist/web-main.js`: authentication, editor, previews, and published sites.
- `dist/worker-main.js`: operations, outbox delivery, and maintenance.
- `dist/migrate.js`: checked-in PostgreSQL migrations.

The containers keep no durable state on disk. Runtime queries use pooled `DATABASE_URL`; migrations use the direct `DATABASE_MIGRATION_URL`. PostgreSQL stores application state and S3-compatible storage holds generated sites.

## Boundaries

Provider-neutral interfaces live in `src/ports`; integrations live in `src/adapters`; `src/runtime-dependencies.ts` connects them. Production uses R2, Cloud Tasks, and Resend. Local Compose substitutes MinIO, a PostgreSQL outbox worker, and Mailpit.

Queue modes are intentionally small:

- `direct`: in-process jobs for `pnpm dev`.
- `postgres`: durable Compose and self-hosted worker.
- `cloud-tasks`: managed delivery to the private production worker.

Every durable mode uses the same operation lease and idempotency rules. See [`.env.example`](../../.env.example) for configuration and the [root README](../../README.md) for commands.
