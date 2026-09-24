# VibeLog application

This package builds the management app and its background worker from one image.

## Entrypoints

- `dist/web-main.js`: authentication, editor, previews, and published sites.
- `dist/worker-main.js`: operations, outbox delivery, and maintenance.
- `dist/migrate.js`: checked-in PostgreSQL migrations.
- `dist/migrate-design-v2.js`: one-time, guarded conversion of saved V1 designs and drafts.

The containers keep no durable state on disk. Runtime queries use pooled `DATABASE_URL`; migrations use the direct `DATABASE_MIGRATION_URL`. PostgreSQL stores application state and S3-compatible storage holds generated sites.

## Boundaries

Provider-neutral interfaces live in `src/ports`; integrations live in `src/adapters`; `src/runtime-dependencies.ts` connects them. Production uses R2, Cloud Tasks, and Resend. Local Compose substitutes MinIO, a PostgreSQL outbox worker, and Mailpit.

Queue modes are intentionally small:

- `direct`: in-process jobs for `pnpm dev`.
- `postgres`: durable Compose and self-hosted worker.
- `cloud-tasks`: managed delivery to the private production worker.

Every durable mode uses the same operation lease and idempotency rules. See [`.env.example`](../../.env.example) for configuration and the [root README](../../README.md) for commands.

## V2 design cutover

The design converter preserves every revision and rebuilds each current draft from its frozen source. Published artifacts remain unchanged. Run it only in a maintenance window after taking a database backup and stopping all web writes, workers, Cloud Tasks delivery, and scheduled jobs. `--maintenance-mode` is an operator assertion, not an automatic traffic block. Keep writers stopped until the V2-only app is deployed; the old app cannot read converted designs. Do not deploy the V2-only app before conversion.

With the same database and object-store environment used by the worker, run `pnpm --filter @vibelog/app db:migrate-design-v2` first. This is read-only and reports `v1Revisions`. Review the count and then run `pnpm --filter @vibelog/app exec node dist/migrate-design-v2.js --apply --maintenance-mode --expected-v1=<count>`. Run the read-only command again and require `v1Revisions: 0` and `v1PreviewSessions: 0` before resuming traffic. The conversion checks for active operations and changed inputs, switches all drafts in one database transaction, and removes uncommitted candidate objects on failure. A failed or interrupted run should be audited again before retrying; do not reset or delete the historical revisions.
