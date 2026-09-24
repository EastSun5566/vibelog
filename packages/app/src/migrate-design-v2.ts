import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { buildBlog, searchIndexIdentity, structuralBuildIdentity } from '@vibelog/core';
import { migratePersistedDesignToV2 } from '@vibelog/core/migration-v1';
import { S3ArtifactStore } from './adapters/s3-artifact-store.js';
import { loadWorkerConfig } from './config.js';

interface DesignRow { id: string; config: unknown }
interface PreviewRow { token_hash: string; theme_config: unknown }
interface BlogRow {
  id: string; username: string; source_artifact_id: string | null;
  draft_artifact_id: string | null; draft_design_revision_id: string | null;
  content_version: number;
}
interface Candidate { blog: BlogRow; artifactId: string }

function siteOrigin(appOrigin: string, username: string): string {
  const app = new URL(appOrigin);
  return `${app.protocol}//${username}.${app.hostname}${app.port ? `:${app.port}` : ''}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const maintenance = args.includes('--maintenance-mode');
  const expectedArg = args.find((arg) => arg.startsWith('--expected-v1='));
  if (args.some((arg) => arg !== '--apply' && arg !== '--maintenance-mode' && !arg.startsWith('--expected-v1='))
    || (apply && (!maintenance || !expectedArg)) || (!apply && maintenance)) {
    throw new Error('Use no arguments for audit, or --apply --maintenance-mode --expected-v1=<count> during a stopped-write maintenance window');
  }
  const expected = expectedArg ? Number(expectedArg.slice('--expected-v1='.length)) : undefined;
  if (expectedArg && (!Number.isSafeInteger(expected) || (expected ?? -1) < 0)) throw new Error('Invalid expected-v1 count');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const client = new Client({ connectionString });
  await client.connect();
  const candidates: Candidate[] = [];
  let committed = false;
  let store: S3ArtifactStore | undefined;
  try {
    const active = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM operations WHERE status IN ('queued', 'running')");
    if (Number(active.rows[0]?.count ?? 0) !== 0) throw new Error('Active operations must finish before design migration');
    const revisions = await client.query<DesignRow>('SELECT id, config FROM theme_revisions ORDER BY id');
    const previews = await client.query<PreviewRow>('SELECT token_hash, theme_config FROM preview_sessions WHERE theme_config IS NOT NULL ORDER BY token_hash');
    const blogs = await client.query<BlogRow>('SELECT id, username, source_artifact_id, draft_artifact_id, draft_design_revision_id, content_version FROM blogs ORDER BY id');
    const converted = revisions.rows.map((row) => ({ id: row.id, old: row.config, version: (row.config as { version?: unknown } | null)?.version, config: migratePersistedDesignToV2(row.config) }));
    const convertedPreviews = previews.rows.map((row) => ({ tokenHash: row.token_hash, old: row.theme_config, version: (row.theme_config as { version?: unknown } | null)?.version, config: migratePersistedDesignToV2(row.theme_config) }));
    const v1 = converted.filter((row) => row.version !== 2).length;
    if (!apply) {
      console.info(JSON.stringify({ event: 'design_v2_migration', mode: 'audit', revisions: revisions.rowCount, v1Revisions: v1, previewSessions: previews.rowCount, v1PreviewSessions: convertedPreviews.filter((row) => row.version !== 2).length, draftsToRebuild: blogs.rows.filter((row) => row.draft_artifact_id).length }));
      return;
    }
    if (expected !== v1) throw new Error(`Expected ${String(expected)} v1 revisions, found ${String(v1)}; no data changed`);
    if (v1 === 0 && convertedPreviews.every((row) => row.version === 2)) {
      console.info(JSON.stringify({ event: 'design_v2_migration', mode: 'already_applied', revisions: revisions.rowCount, rebuiltDrafts: 0 }));
      return;
    }
    const config = loadWorkerConfig();
    store = new S3ArtifactStore(config.objectStore);
    // Candidate artifacts are not referenced by a blog until every build succeeds.
    for (const blog of blogs.rows) {
      if (!blog.draft_artifact_id) continue;
      if (!blog.source_artifact_id || !blog.draft_design_revision_id) throw new Error('A draft has no frozen source or design revision');
      const design = converted.find((row) => row.id === blog.draft_design_revision_id)?.config;
      if (!design) throw new Error('Draft design revision disappeared');
      const artifactId = randomUUID();
      await client.query('INSERT INTO artifacts (id, blog_id, kind, key_prefix, state) VALUES ($1, $2, $3, $4, $5)', [artifactId, blog.id, 'draft', `artifacts/${artifactId}/`, 'uploading']);
      candidates.push({ blog, artifactId });
      const work = await mkdtemp(join(tmpdir(), 'vibelog-v2-migration-'));
      try {
        const sourceDir = join(work, 'source');
        const compileDir = join(work, 'compile');
        const outDir = join(compileDir, 'dist');
        await store.materializeArtifact(blog.source_artifact_id, sourceDir);
        const site = siteOrigin(config.appOrigin, blog.username);
        await buildBlog({ sourceDir, design, workDir: compileDir, outDir, site, searchIdentity: searchIndexIdentity(blog.source_artifact_id, site), buildIdentity: structuralBuildIdentity(blog.source_artifact_id, design, site) });
        await store.uploadDirectory(artifactId, outDir);
      } finally { await rm(work, { recursive: true, force: true }); }
    }
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const pending = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM operations WHERE status IN ('queued', 'running')");
    if (Number(pending.rows[0]?.count ?? 0) !== 0) throw new Error('An operation started during migration preparation');
    const lockedRevisions = await client.query<DesignRow>('SELECT id, config FROM theme_revisions ORDER BY id FOR UPDATE');
    const lockedPreviews = await client.query<PreviewRow>('SELECT token_hash, theme_config FROM preview_sessions WHERE theme_config IS NOT NULL ORDER BY token_hash FOR UPDATE');
    const lockedBlogs = await client.query<BlogRow>('SELECT id, username, source_artifact_id, draft_artifact_id, draft_design_revision_id, content_version FROM blogs ORDER BY id FOR UPDATE');
    if (lockedRevisions.rowCount !== revisions.rowCount || lockedPreviews.rowCount !== previews.rowCount || lockedBlogs.rowCount !== blogs.rowCount) throw new Error('Migration inputs changed during draft preparation');
    for (let i = 0; i < converted.length; i += 1) {
      const before = converted[i]; const now = lockedRevisions.rows[i];
      if (!before || !now || before.id !== now.id || JSON.stringify(before.old) !== JSON.stringify(now.config)) throw new Error('A design revision changed during draft preparation');
    }
    for (let i = 0; i < convertedPreviews.length; i += 1) {
      const before = convertedPreviews[i]; const now = lockedPreviews.rows[i];
      if (!before || !now || before.tokenHash !== now.token_hash || JSON.stringify(before.old) !== JSON.stringify(now.theme_config)) throw new Error('A preview session changed during draft preparation');
    }
    for (let i = 0; i < blogs.rows.length; i += 1) {
      const before = blogs.rows[i]; const now = lockedBlogs.rows[i];
      if (!before || !now || before.id !== now.id || before.source_artifact_id !== now.source_artifact_id || before.draft_artifact_id !== now.draft_artifact_id || before.draft_design_revision_id !== now.draft_design_revision_id || before.content_version !== now.content_version) throw new Error('A blog changed during draft preparation');
    }
    for (const row of converted) {
      if (row.version !== 2) await client.query('UPDATE theme_revisions SET config = $2::jsonb WHERE id = $1', [row.id, JSON.stringify(row.config)]);
    }
    for (const row of convertedPreviews) {
      if (row.version !== 2) await client.query('UPDATE preview_sessions SET theme_config = $2::jsonb WHERE token_hash = $1', [row.tokenHash, JSON.stringify(row.config)]);
    }
    for (const candidate of candidates) {
      await client.query("UPDATE artifacts SET state = 'ready', ready_at = now() WHERE id = $1 AND state = 'uploading'", [candidate.artifactId]);
      await client.query('UPDATE blogs SET draft_artifact_id = $2, updated_at = now() WHERE id = $1', [candidate.blog.id, candidate.artifactId]);
      await client.query("UPDATE artifacts SET state = 'cleanup_pending' WHERE id = $1", [candidate.blog.draft_artifact_id]);
    }
    const remaining = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM theme_revisions WHERE config->>'version' IS DISTINCT FROM '2'");
    if (Number(remaining.rows[0]?.count ?? -1) !== 0) throw new Error('Some design revisions were not converted');
    await client.query('COMMIT');
    committed = true;
    console.info(JSON.stringify({ event: 'design_v2_migration', mode: 'applied', revisions: revisions.rowCount, convertedRevisions: v1, convertedPreviewSessions: convertedPreviews.filter((row) => row.version !== 2).length, rebuiltDrafts: candidates.length }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (!committed) {
      for (const candidate of candidates) {
        await client.query("UPDATE artifacts SET state = 'cleanup_pending' WHERE id = $1", [candidate.artifactId]).catch(() => undefined);
        await store?.deleteArtifact(candidate.artifactId).catch(() => undefined);
      }
    }
    await client.end();
  }
}

await main();
