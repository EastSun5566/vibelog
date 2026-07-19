import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@vibelog/core';
import { AppDatabase, AiQuotaExceededError } from '../src/database.js';
import { user } from '../src/schema.js';

const roots: string[] = [];
async function subject() { const root = await mkdtemp(join(tmpdir(), 'vibelog-db-')); roots.push(root); return new AppDatabase(root); }
function addUser(database: AppDatabase, id: string, username: string) { const date = new Date(); database.db.insert(user).values({ id, name: username, email: `${username}@users.vibelog.invalid`, emailVerified: false, username, displayUsername: username, createdAt: date, updatedAt: date }).run(); }
function previewFor(database: AppDatabase, blog: { id: string; userId: string }, tokenHash: string): string {
  const theme = database.getActiveTheme(blog.id); if (!theme) throw new Error('Theme missing');
  database.createPreviewSession(tokenHash, blog.userId, blog.id, '2099-01-01T00:00:00.000Z', theme.config);
  return tokenHash;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('AppDatabase 0.5 model', () => {
  it('refuses a pre-0.5 volume instead of attempting a partial migration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-legacy-')); roots.push(root);
    const legacy = new DatabaseSync(join(root, 'vibelog.sqlite'));
    legacy.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
    legacy.close();
    expect(() => new AppDatabase(root)).toThrow('pre-0.5');
  });
  it('enforces one blog per user and immutable revision activation', async () => {
    const database = await subject(); addUser(database, '11111111-1111-4111-8111-111111111111', 'alice');
    const { blog, operation } = database.createBlog('11111111-1111-4111-8111-111111111111', 'alice', 'hackmd-alice');
    expect(() => database.createBlog(blog.userId, 'alice-two', 'other')).toThrow();
    database.completeOperation(operation.id);
    const second = database.createTheme(blog.id, { ...DEFAULT_THEME, description: 'Second safe theme' }, 'change');
    expect(database.listThemes(blog.id)).toHaveLength(2);
    expect(second.source).toBe('ai');
    const first = database.listThemes(blog.id).find((theme) => theme.id !== second.id);
    expect(first).toBeDefined();
    if (!first) throw new Error('Initial theme missing');
    database.activateTheme(first.id, blog.id);
    expect(database.getActiveTheme(blog.id)?.id).toBe(first.id);
    database.close();
  });
  it('creates manual revisions without allowing a background operation to overwrite user intent', async () => {
    const database = await subject(); addUser(database, '12121212-1212-4212-8212-121212121212', 'manual');
    const { blog, operation } = database.createBlog('12121212-1212-4212-8212-121212121212', 'manual', 'manual'); database.completeOperation(operation.id);
    const manual = database.createManualTheme(blog.userId, blog.id, { ...DEFAULT_THEME, radius: 'round', description: 'Manual revision' });
    expect(manual).toMatchObject({ source: 'manual', prompt: null, active: true });
    const generate = database.createThemeOperation(blog.userId, blog.id, 'later', manual.config, { userDailyLimit: 20, globalDailyLimit: 200 });
    const initial = database.listThemes(blog.id).find((theme) => theme.source === 'system'); if (!initial) throw new Error('Initial theme missing');
    expect(() => { database.activateTheme(initial.id, blog.id); }).toThrow('active operation');
    expect(() => database.createManualTheme(blog.userId, blog.id, { ...DEFAULT_THEME, description: 'Blocked' })).toThrow('active operation');
    database.failOperation(generate.id, 'stopped');
    database.close();
  });
  it('recovers a failed initial source but locks it after the first successful sync', async () => {
    const database = await subject(); addUser(database, '44444444-4444-4444-8444-444444444444', 'carol');
    const { blog, operation } = database.createBlog('44444444-4444-4444-8444-444444444444', 'carol', 'wrong-source');
    database.failOperation(operation.id, 'not found'); database.failSync(blog.id, 'not found');
    const retry = database.retryInitialSync(blog.userId, 'correct-source');
    expect(database.getBlog(blog.id)).toMatchObject({ hackmdUsername: 'correct-source', state: 'syncing', lastError: null, contentVersion: 0 });
    database.completeOperation(retry.id);
    database.completeSync(blog.id, {
      title: 'Carol', description: '', author: 'Carol', draftArtifact: '/tmp/draft', lastSyncedAt: '2026-07-19T12:00:00.000Z',
      contentManifest: [
        { title: 'Older', slug: 'older', publishedAt: '2026-01-01T00:00:00.000Z' },
        { title: 'Newer', slug: 'newer', publishedAt: '2026-02-01T00:00:00.000Z' },
      ],
    });
    expect(database.getBlog(blog.id)).toMatchObject({
      contentVersion: 1,
      lastSyncedAt: '2026-07-19T12:00:00.000Z',
      contentManifest: [
        { title: 'Newer', slug: 'newer', publishedAt: '2026-02-01T00:00:00.000Z' },
        { title: 'Older', slug: 'older', publishedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    expect(() => database.retryInitialSync(blog.userId, 'another-source')).toThrow('already has synced content');
    database.failSync(blog.id, 'temporary failure');
    expect(database.getBlog(blog.id)).toMatchObject({ contentVersion: 1, state: 'ready', lastError: 'temporary failure' });
    database.close();
  });
  it('snapshots identity sync input and rejects unchanged or concurrent work', async () => {
    const database = await subject(); addUser(database, '14141414-1414-4414-8414-141414141414', 'identity');
    const { blog, operation } = database.createBlog('14141414-1414-4414-8414-141414141414', 'identity', 'identity');
    database.completeOperation(operation.id);
    database.completeSync(blog.id, { title: 'Current title', description: 'Current description', author: 'Writer', draftArtifact: '/tmp/identity-draft' });
    expect(() => database.createSyncOperation(blog.userId, blog.id, { intent: 'identity', site: { title: 'Current title', description: 'Current description' } })).toThrow('Nothing to update');
    const update = database.createSyncOperation(blog.userId, blog.id, { intent: 'identity', site: { title: 'New title', description: 'New description' } });
    expect(update.payload).toEqual({ intent: 'identity', site: { title: 'New title', description: 'New description' } });
    expect(() => database.createSyncOperation(blog.userId, blog.id, { intent: 'content' })).toThrow('active operation');
    database.close();
  });
  it('snapshots content and theme when publishing and rejects redundant work', async () => {
    const database = await subject(); addUser(database, '55555555-5555-4555-8555-555555555555', 'dave');
    const { blog, operation } = database.createBlog('55555555-5555-4555-8555-555555555555', 'dave', 'dave'); database.completeOperation(operation.id);
    database.completeSync(blog.id, { title: 'Dave', description: '', author: 'Dave', draftArtifact: '/tmp/draft' });
    const current = database.getBlog(blog.id); const theme = database.getActiveTheme(blog.id);
    if (!current || !theme) throw new Error('Fixture missing');
    const publish = database.createPublishOperation(blog.userId, blog.id, previewFor(database, blog, 'publish-preview'));
    expect(publish.payload).toEqual({ contentVersion: 1, themeRevisionId: theme.id });
    database.completeOperation(publish.id);
    database.activateRelease(blog.id, theme.id, current.contentVersion, '/tmp/release');
    expect(() => database.createPublishOperation(blog.userId, blog.id, previewFor(database, blog, 'redundant-preview'))).toThrow('Nothing to publish');
    const secondTheme = database.createTheme(blog.id, { ...DEFAULT_THEME, description: 'A new draft theme' }, 'change');
    expect(database.createPublishOperation(blog.userId, blog.id, previewFor(database, blog, 'changed-preview')).payload).toEqual({ contentVersion: 1, themeRevisionId: secondTheme.id });
    database.close();
  });
  it('removes expired preview sessions while retaining valid access', async () => {
    const database = await subject(); addUser(database, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'helen');
    const { blog } = database.createBlog('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'helen', 'helen');
    database.createPreviewSession('expired-token', blog.userId, blog.id, '2020-01-01T00:00:00.000Z', DEFAULT_THEME);
    database.createPreviewSession('valid-token', blog.userId, blog.id, '2099-01-01T00:00:00.000Z', DEFAULT_THEME);
    expect(database.getPreviewSession('expired-token')).toBeNull();
    expect(database.getPreviewSession('valid-token')).toMatchObject({ tokenHash: 'valid-token', userId: blog.userId, blogId: blog.id, themeConfig: DEFAULT_THEME });
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM preview_sessions').get()).toMatchObject({ count: 1 });
    database.close();
  });
  it('blocks publishing when the short-lived preview differs from the saved revision', async () => {
    const database = await subject(); addUser(database, '13131313-1313-4313-8313-131313131313', 'unsaved');
    const { blog, operation } = database.createBlog('13131313-1313-4313-8313-131313131313', 'unsaved', 'unsaved'); database.completeOperation(operation.id);
    database.completeSync(blog.id, { title: 'Unsaved', description: '', author: 'Unsaved', draftArtifact: '/tmp/draft' });
    previewFor(database, blog, 'unsaved-preview');
    database.updatePreviewTheme('unsaved-preview', blog.userId, blog.id, { ...DEFAULT_THEME, radius: 'round', description: 'Unsaved preview' });
    expect(() => database.createPublishOperation(blog.userId, blog.id, 'unsaved-preview')).toThrow('unsaved theme changes');
    database.close();
  });
  it('migrates a 0.5.0-beta.1 database without losing its records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-beta-migration-')); roots.push(root);
    const path = join(root, 'vibelog.sqlite'); const legacy = new DatabaseSync(path);
    const baseline = await readFile(new URL('../src/drizzle/0000_good_impossible_man.sql', import.meta.url), 'utf8');
    for (const statement of baseline.split('--> statement-breakpoint').map((item) => item.trim()).filter(Boolean)) legacy.exec(statement);
    legacy.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at INTEGER NOT NULL); INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('baseline', 1784405352638)");
    const timestamp = new Date('2026-07-19T00:00:00.000Z').toISOString();
    legacy.prepare('INSERT INTO user (id,name,email,email_verified,username,display_username,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('66666666-6666-4666-8666-666666666666', 'erin', 'erin@users.vibelog.invalid', 0, 'erin', 'erin', Date.now(), Date.now());
    legacy.prepare('INSERT INTO blogs (id,user_id,username,hackmd_username,state,draft_artifact,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('77777777-7777-4777-8777-777777777777', '66666666-6666-4666-8666-666666666666', 'erin', 'erin-hackmd', 'ready', '/tmp/existing-draft', timestamp, timestamp);
    legacy.prepare('INSERT INTO theme_revisions (id,blog_id,config,prompt,description,active,created_at) VALUES (?,?,?,?,?,?,?)').run('78787878-7878-4787-8787-787878787878', '77777777-7777-4777-8777-777777777777', JSON.stringify(DEFAULT_THEME), 'make it quiet', DEFAULT_THEME.description, 1, timestamp);
    legacy.close();
    const database = new AppDatabase(root, path);
    expect(database.getBlogForUser('66666666-6666-4666-8666-666666666666')).toMatchObject({ username: 'erin', contentVersion: 1, draftArtifact: '/tmp/existing-draft', contentManifest: null, lastSyncedAt: null });
    expect(database.getActiveTheme('77777777-7777-4777-8777-777777777777')?.source).toBe('ai');
    database.close();
  });
  it('charges accepted AI work and rejects user/global quota without creating work', async () => {
    const database = await subject(); addUser(database, '22222222-2222-4222-8222-222222222222', 'bob');
    const { blog, operation } = database.createBlog('22222222-2222-4222-8222-222222222222', 'bob', 'bob'); database.completeOperation(operation.id);
    const first = database.createThemeOperation(blog.userId, blog.id, 'one', DEFAULT_THEME, { userDailyLimit: 1, globalDailyLimit: 5, at: new Date('2026-07-19T12:00:00Z') });
    database.completeOperation(first.id);
    expect(() => database.createThemeOperation(blog.userId, blog.id, 'two', DEFAULT_THEME, { userDailyLimit: 1, globalDailyLimit: 5, at: new Date('2026-07-19T13:00:00Z') })).toThrow(AiQuotaExceededError);
    database.close();
  });
});
