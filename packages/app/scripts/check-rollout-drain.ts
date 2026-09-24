import { Client } from 'pg';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error('DATABASE_MIGRATION_URL is required');
const client = new Client({ connectionString: url });
try {
  await client.connect();
  const result = await client.query<{ active: string; pending_outbox: string }>(`
    SELECT
      (SELECT count(*) FROM operations WHERE status IN ('queued', 'running'))::text AS active,
      (SELECT count(*) FROM operation_outbox WHERE dispatched_at IS NULL)::text AS pending_outbox
  `);
  const active = Number(result.rows[0]?.active ?? -1);
  const pendingOutbox = Number(result.rows[0]?.pending_outbox ?? -1);
  console.info(JSON.stringify({ event: 'rollout_drain_check', activeOperations: active, pendingOutbox }));
  if (active !== 0 || pendingOutbox !== 0) throw new Error('Operations and outbox must be empty before locking');
} finally {
  await client.end();
}
