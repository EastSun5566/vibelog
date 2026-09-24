import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { DEFAULT_DESIGN } from '@vibelog/core/migration-v1';

interface BlogRow { id: string; user_id: string; draft_artifact_id: string | null }
interface RevisionRow { id: string; config: { version: number; theme: { motif: string } } }
interface ReleaseRow { id: string; artifact_id: string }
interface PreviewRow { theme_config: { version: number } | null }
interface DraftRow { draft_artifact_id: string | null }
interface ArtifactRow { id: string; state: string }
interface MigrationEvent { mode: string; v1Revisions?: number; v1PreviewSessions?: number; convertedRevisions?: number }

const project = process.env.COMPOSE_PROJECT_NAME;
const port = Number(process.env.POSTGRES_PORT);
if (!project?.startsWith('vibelog-e2e-') || !Number.isSafeInteger(port) || port < 1024) {
  throw new Error('This migration exercise runs only against the local Compose E2E project');
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const client = new Client({ connectionString: `postgresql://vibelog:local-vibelog@127.0.0.1:${String(port)}/vibelog` });
function container(...args: string[]): string {
  return execFileSync('docker', ['compose', 'run', '--rm', '--no-deps', 'web', 'node', 'dist/migrate-design-v2.js', ...args], {
    cwd: root, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5 * 60 * 1000,
  });
}
function event(output: string): MigrationEvent {
  const line = output.split('\n').find((entry) => entry.startsWith('{"event":"design_v2_migration"'));
  if (!line) throw new Error('The design migration did not report a result');
  const parsed: unknown = JSON.parse(line);
  if (!parsed || typeof parsed !== 'object' || !('mode' in parsed) || typeof parsed.mode !== 'string') throw new Error('Invalid design migration result');
  return parsed as MigrationEvent;
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

await client.connect();
try {
  const blog = (await client.query<BlogRow>("SELECT id, user_id, draft_artifact_id FROM blogs WHERE username = 'alice'")).rows[0];
  assert(blog?.draft_artifact_id, 'The E2E fixture must leave Alice with a draft');
  const beforeRevisions = (await client.query<RevisionRow>('SELECT id, config FROM theme_revisions WHERE blog_id = $1 ORDER BY created_at, id', [blog.id])).rows;
  assert(beforeRevisions.length >= 2, 'The E2E fixture must create design history');
  const beforeReleases = (await client.query<ReleaseRow>('SELECT id, artifact_id FROM published_releases WHERE blog_id = $1 ORDER BY id', [blog.id])).rows;
  assert(beforeReleases.length >= 1, 'The E2E fixture must publish a release');

  // Simulate historical V1 data only after the app and worker have stopped.
  const expectedMotifs = new Map<string, string>();
  for (const [index, revision] of beforeRevisions.entries()) {
    const legacy = structuredClone(DEFAULT_DESIGN);
    legacy.theme.motif = index % 2 === 0 ? 'minimal' : 'editorial';
    expectedMotifs.set(revision.id, legacy.theme.motif);
    await client.query('UPDATE theme_revisions SET config = $2::jsonb WHERE id = $1', [revision.id, JSON.stringify(legacy)]);
  }
  const previewId = `e2e-v1-${randomUUID()}`;
  await client.query("INSERT INTO preview_sessions (token_hash, user_id, blog_id, theme_config, expires_at) VALUES ($1, $2, $3, $4::jsonb, now() + interval '1 hour')", [previewId, blog.user_id, blog.id, JSON.stringify(DEFAULT_DESIGN)]);

  const queuedId = randomUUID();
  await client.query("INSERT INTO operations (id, user_id, blog_id, type, status, payload) VALUES ($1, $2, $3, 'sync', 'queued', '{}'::jsonb)", [queuedId, blog.user_id, blog.id]);
  try {
    container();
    throw new Error('The active-operation guard allowed a queued operation');
  } catch (error) {
    if (!(error instanceof Error) || error.message === 'The active-operation guard allowed a queued operation') throw error;
    assert(String((error as Error & { stderr?: string }).stderr).includes('Active operations must finish'), 'The active-operation guard failed for an unrelated reason');
  } finally {
    await client.query('DELETE FROM operations WHERE id = $1', [queuedId]);
  }

  const audit = event(container());
  assert(audit.v1Revisions === beforeRevisions.length && (audit.v1PreviewSessions ?? 0) >= 1, 'Audit missed legacy designs');
  try {
    container('--apply', '--maintenance-mode', `--expected-v1=${String(beforeRevisions.length + 1)}`);
    throw new Error('The expected-count guard allowed a mismatch');
  } catch (error) {
    if (!(error instanceof Error) || error.message === 'The expected-count guard allowed a mismatch') throw error;
    const stderr = String((error as Error & { stderr?: string }).stderr);
    assert(stderr.includes('Expected') && stderr.includes('v1 revisions'), 'The expected-count guard failed for an unrelated reason');
  }
  assert((await client.query<RevisionRow>('SELECT id, config FROM theme_revisions WHERE id = $1', [beforeRevisions[0]?.id])).rows[0]?.config.version === 1, 'A rejected migration changed a revision');
  const applied = event(container('--apply', '--maintenance-mode', `--expected-v1=${String(beforeRevisions.length)}`));
  assert(applied.mode === 'applied' && applied.convertedRevisions === beforeRevisions.length, 'Conversion did not complete');
  const revisions = (await client.query<RevisionRow>('SELECT id, config FROM theme_revisions WHERE blog_id = $1 ORDER BY created_at, id', [blog.id])).rows;
  assert(revisions.length === beforeRevisions.length, 'Design history length changed');
  for (const revision of revisions) {
    assert(revision.config.version === 2 && revision.config.theme.motif === expectedMotifs.get(revision.id), 'A historical revision was not preserved');
  }
  const preview = (await client.query<PreviewRow>('SELECT theme_config FROM preview_sessions WHERE token_hash = $1', [previewId])).rows[0];
  assert(preview?.theme_config?.version === 2, 'The preview session was not converted');
  const draft = (await client.query<DraftRow>('SELECT draft_artifact_id FROM blogs WHERE id = $1', [blog.id])).rows[0];
  assert(draft?.draft_artifact_id && draft.draft_artifact_id !== blog.draft_artifact_id, 'The current draft was not rebuilt');
  const artifacts = (await client.query<ArtifactRow>('SELECT id, state FROM artifacts WHERE id = ANY($1::uuid[])', [[blog.draft_artifact_id, draft.draft_artifact_id]])).rows;
  assert(artifacts.find((item) => item.id === blog.draft_artifact_id)?.state === 'cleanup_pending', 'The old draft was not retired');
  assert(artifacts.find((item) => item.id === draft.draft_artifact_id)?.state === 'ready', 'The new draft is not ready');
  const releases = (await client.query<ReleaseRow>('SELECT id, artifact_id FROM published_releases WHERE blog_id = $1 ORDER BY id', [blog.id])).rows;
  assert(JSON.stringify(releases) === JSON.stringify(beforeReleases), 'Published history changed');
  assert(event(container()).v1Revisions === 0, 'V1 revisions remain after conversion');
  assert(event(container('--apply', '--maintenance-mode', '--expected-v1=0')).mode === 'already_applied', 'Conversion is not idempotent');
  console.info('Design V2 migration preserved revisions, drafts, previews, and published releases');
} finally {
  await client.end();
}
