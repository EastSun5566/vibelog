# VibeLog application

This package builds the management app and its background worker from one image.

## Entrypoints

- `dist/web-main.js`: authentication, editor, previews, and published sites.
- `dist/worker-main.js`: operations, outbox delivery, and maintenance.
- `dist/migrate.js`: checked-in PostgreSQL migrations.
- `dist/migrate-design-v2.js`: one-time, guarded conversion of saved V1 designs and drafts.

The containers keep no durable state on disk. Runtime queries use pooled `DATABASE_URL`; migrations use the direct `DATABASE_MIGRATION_URL`. PostgreSQL stores application state and S3-compatible storage holds generated sites.

## Boundaries

Provider-neutral interfaces live in `src/ports`; integrations live in `src/adapters`; `src/runtime-dependencies.ts` connects them. Production uses R2, Cloud Tasks, and Resend. Local Compose substitutes an S3 mock, a PostgreSQL outbox worker, and Mailpit.

Queue modes are intentionally small:

- `direct`: in-process jobs for `pnpm dev`.
- `postgres`: durable Compose and self-hosted worker.
- `cloud-tasks`: managed delivery to the private production worker.

Every durable mode uses the same operation lease and idempotency rules. See [`.env.example`](../../.env.example) for configuration and the [root README](../../README.md) for commands.

## V2 design cutover

The design converter preserves every revision and rebuilds each current draft from its frozen source. Published artifacts remain unchanged. Run it only in a maintenance window after taking a database backup and stopping all web writes, workers, Cloud Tasks delivery, and scheduled jobs. `--maintenance-mode` is an operator assertion, not an automatic traffic block. Keep writers stopped until the V2-only app is deployed; the old app cannot read converted designs. Do not deploy the V2-only app before conversion.

With the same database and object-store environment used by the worker, run `pnpm --filter @vibelog/app db:migrate-design-v2` first. This is read-only and reports `v1Revisions`. Review the count and then run `pnpm --filter @vibelog/app exec node dist/migrate-design-v2.js --apply --maintenance-mode --expected-v1=<count>`. Run the read-only command again and require `v1Revisions: 0` and `v1PreviewSessions: 0` before resuming traffic. The conversion checks for active operations and changed inputs, switches all drafts in one database transaction, and removes uncommitted candidate objects on failure. A failed or interrupted run should be audited again before retrying; do not reset or delete the historical revisions.

## Agent onboarding v1

`/api/agent/v1` accepts a separate opaque `draft:read-write` bearer grant, never a browser session. Pairing lasts ten minutes; the human signs in, confirms the code and explicitly approves a twelve-hour grant at `/agent/authorize`. Approval/revocation forms use the normal Origin and CSRF checks. Tokens and private device codes are stored only as hashes; the one-time token response is not logged. `/account/agents` lists active grants and allows owner-only revocation.

The JSON API provides `session`, `context`, paginated `posts`, `design/contract`, `design/validate`, `connect`, `sync`, `identity`, `selection`, `design`, and owner-scoped `operations/:id`. There are no publish, restore, export, deletion, hosted Generate, or public patch endpoints. See the [CLI JSON inputs](../cli/README.md).

Mutations require `Idempotency-Key`; all except initial connect also require the context's `stateVersion`. A transaction locks the owner and blog, checks state, claims the request key, admits quota, and inserts the existing operation/outbox. A replay returns its original result before stale-state checks; different input under the same key is a conflict. No-op design/details/selection edits do not start builds. User/global build limits are 10/50 per UTC day, separate from hosted AI usage. Worker completion still checks its captured draft/content snapshots and records external designs as `agent` revisions.

Daily maintenance removes expired pairings/grants and old usage/request records. Pending operations keep their idempotency records. Account deletion cascades grants and removes user usage. The additive Drizzle migration must run before serving the new endpoints; existing designs and published releases do not change.

Leave `VIBELOG_AGENT_CLI_VERSION` unset until the independent CLI publish gate and API deployment are complete. A tested, pinned stable version enables the homepage prompt and `/agent-setup/prompt.md`; it does not automatically install or publish a package.
