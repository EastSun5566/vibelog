import { Client } from 'pg';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error('DATABASE_MIGRATION_URL is required');
const client = new Client({ connectionString: url });
try {
  await client.connect();
  const result = await client.query<{ revisions: string; previews: string }>(`
    SELECT
      (SELECT count(*) FROM theme_revisions WHERE config->>'version' IS DISTINCT FROM '2')::text AS revisions,
      (SELECT count(*) FROM preview_sessions WHERE theme_config IS NOT NULL AND theme_config->>'version' IS DISTINCT FROM '2')::text AS previews
  `);
  const revisions = Number(result.rows[0]?.revisions ?? -1);
  const previews = Number(result.rows[0]?.previews ?? -1);
  console.info(JSON.stringify({ event: 'design_v2_compatibility_check', v1Revisions: revisions, v1PreviewSessions: previews }));
  if (revisions !== 0 || previews !== 0) throw new Error('V1 designs remain; run the locked design-v2 conversion before deploying V2');
} finally {
  await client.end();
}
