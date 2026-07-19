import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@vibelog/core';
import type { AppConfig } from '../src/config.js';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { createApp } from '../src/index.js';

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vibelog-app-')); roots.push(root);
  const config: AppConfig = { nodeEnv: 'test', dataRoot: root, appOrigin: 'http://app.localtest.me:3000', appHostname: 'app.localtest.me', previewOrigin: 'http://preview.app.localtest.me:3000', betterAuthSecret: 'a'.repeat(32), betaInviteDigest: createHash('sha256').update('invite-code-with-24-characters').digest(), aiUserDailyLimit: 20, aiGlobalDailyLimit: 200, aiProvider: 'openai', aiModel: 'gpt-4o-mini', secureCookies: false };
  const database = new AppDatabase(root); return { ...createApp({ config, database }), config, root };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const form = (values: Record<string, string>) => new URLSearchParams(values);
const studioControls = { preset: 'editorial', palette: 'newsprint', bodyFont: 'system-serif', headingFont: 'system-sans', scale: 'large', contentWidth: 'wide', density: 'compact', radius: 'none' };
function previewToken(html: string): string {
  const token = /name="previewToken" value="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error('Editor did not include a preview token');
  return token;
}
async function register(app: ReturnType<typeof createApp>['app'], username: string) {
  const response = await app.request('http://app.localtest.me:3000/auth/register', { method: 'POST', headers: { host: 'app.localtest.me:3000', origin: 'http://app.localtest.me:3000', 'x-forwarded-for': '9.9.9.9', 'content-type': 'application/x-www-form-urlencoded' }, body: form({ inviteCode: 'invite-code-with-24-characters', username, password: 'long-enough-password' }) });
  const cookie = response.headers.get('set-cookie')?.match(/vibelog[^=]*=[^;]+/)?.[0];
  if (!cookie) throw new Error('Registration did not set a session cookie');
  const session = await app.request('http://app.localtest.me:3000/api/session', { headers: { host: 'app.localtest.me:3000', cookie } });
  return { cookie, csrfToken: String((await session.json() as { csrfToken: string }).csrfToken) };
}

describe('hosted app boundaries', () => {
  it('uses a wildcard localhost domain by default', () => {
    const config = loadAppConfig({ BETTER_AUTH_SECRET: 'a'.repeat(32), BETA_INVITE_CODE: 'invite-code-with-24-characters' });
    expect(config.appOrigin).toBe('http://app.localtest.me:3000');
    expect(config.previewOrigin).toBe('http://preview.app.localtest.me:3000');
  });

  it('requires the beta code, reserves system usernames, and creates a host-only session', async () => {
    const { app, database } = await setup();
    const reserved = await app.request('http://app.localtest.me:3000/auth/register', { method: 'POST', headers: { host: 'app.localtest.me:3000', origin: 'http://app.localtest.me:3000', 'x-forwarded-for': '1.1.1.1', 'content-type': 'application/x-www-form-urlencoded' }, body: form({ inviteCode: 'invite-code-with-24-characters', username: 'preview', password: 'long-enough-password' }) });
    expect(reserved.status).toBe(400);
    const denied = await app.request('http://app.localtest.me:3000/auth/register', { method: 'POST', headers: { host: 'app.localtest.me:3000', origin: 'http://app.localtest.me:3000', 'x-forwarded-for': '2.2.2.2', 'content-type': 'application/x-www-form-urlencoded' }, body: form({ inviteCode: 'wrong-code', username: 'alice', password: 'long-enough-password' }) });
    expect(denied.status).toBe(401);
    const response = await app.request('http://app.localtest.me:3000/auth/register', { method: 'POST', headers: { host: 'app.localtest.me:3000', origin: 'http://app.localtest.me:3000', 'x-forwarded-for': '3.3.3.3', 'content-type': 'application/x-www-form-urlencoded' }, body: form({ inviteCode: 'invite-code-with-24-characters', username: 'Alice', password: 'long-enough-password' }) });
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('vibelog');
    expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    database.close();
  });
  it('serves only active immutable releases on username hosts', async () => {
    const { app, database, root } = await setup();
    const date = new Date();
    database.connection.prepare('INSERT INTO user (id,name,email,email_verified,username,display_username,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('33333333-3333-4333-8333-333333333333', 'alice', 'alice@users.vibelog.invalid', 0, 'alice', 'alice', date.getTime(), date.getTime());
    const { blog, operation } = database.createBlog('33333333-3333-4333-8333-333333333333', 'alice', 'alice'); database.completeOperation(operation.id);
    const release = join(root, 'release');
    await mkdir(release, { recursive: true }); await writeFile(join(release, 'index.html'), '<h1>Published</h1>');
    const theme = database.getActiveTheme(blog.id);
    if (!theme) throw new Error('Active theme missing');
    database.activateRelease(blog.id, theme.id, blog.contentVersion, release);
    const published = await app.request('http://alice.app.localtest.me:3000/', { headers: { host: 'alice.app.localtest.me:3000' } });
    expect(await published.text()).toContain('Published');
    expect(published.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect((await app.request('http://unknown.example/', { headers: { host: 'unknown.example' } })).status).toBe(404);
    database.close();
  });
  it('renders release history, validates artifacts, and restores the live release with revalidation', async () => {
    const { app, database, root } = await setup(); const auth = await register(app, 'rollback');
    const session = await app.request('http://app.localtest.me:3000/api/session', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    const userId = String((await session.json() as { user: { id: string } }).user.id);
    const { blog, operation } = database.createBlog(userId, 'rollback', 'rollback'); database.completeOperation(operation.id);
    const draftA = join(root, 'blogs', userId, blog.id, 'drafts', 'draft-a'); await mkdir(draftA, { recursive: true }); await writeFile(join(draftA, 'index.html'), '<h1>Draft A</h1>');
    database.completeSync(blog.id, { title: 'Draft A', description: '', author: 'Writer', draftArtifact: draftA });
    const themeA = database.getActiveTheme(blog.id); if (!themeA) throw new Error('Initial theme missing');
    const releasesRoot = join(root, 'blogs', userId, blog.id, 'releases');
    const artifactA = join(releasesRoot, 'release-a'); await mkdir(artifactA, { recursive: true }); await writeFile(join(artifactA, 'index.html'), '<h1>Release A</h1>'); await writeFile(join(artifactA, 'about.html'), '<p>About A</p>');
    const releaseA = database.activateRelease(blog.id, themeA.id, 1, artifactA);

    const draftB = join(root, 'blogs', userId, blog.id, 'drafts', 'draft-b'); await mkdir(draftB, { recursive: true }); await writeFile(join(draftB, 'index.html'), '<h1>Draft B</h1>');
    database.completeSync(blog.id, { title: 'Draft B', description: '', author: 'Writer', draftArtifact: draftB });
    const themeB = database.createTheme(blog.id, { ...DEFAULT_THEME, radius: 'round', description: 'Second release theme' }, 'change');
    const artifactB = join(releasesRoot, 'release-b'); await mkdir(artifactB, { recursive: true }); await writeFile(join(artifactB, 'index.html'), '<h1>Release B</h1>'); await writeFile(join(artifactB, 'about.html'), '<p>About B</p>');
    const releaseB = database.activateRelease(blog.id, themeB.id, 2, artifactB);

    const editor = await app.request('http://app.localtest.me:3000/editor', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    const editorHtml = await editor.text();
    expect(editorHtml).toContain('發布紀錄（2）'); expect(editorHtml).toContain('Second release theme'); expect(editorHtml).toContain('目前線上'); expect(editorHtml).not.toContain(artifactA);

    const publicB = await app.request('http://rollback.app.localtest.me:3000/', { headers: { host: 'rollback.app.localtest.me:3000' } });
    const etagB = publicB.headers.get('etag'); if (!etagB) throw new Error('Release ETag missing');
    expect(await publicB.text()).toContain('Release B'); expect(publicB.headers.get('cache-control')).toBe('public, no-cache');
    const unchanged = await app.request('http://rollback.app.localtest.me:3000/', { headers: { host: 'rollback.app.localtest.me:3000', 'if-none-match': etagB } });
    expect(unchanged.status).toBe(304); expect(await unchanged.text()).toBe(''); expect(unchanged.headers.get('content-security-policy')).toContain("script-src 'none'");
    const otherPath = await app.request('http://rollback.app.localtest.me:3000/about.html', { headers: { host: 'rollback.app.localtest.me:3000' } });
    expect(otherPath.headers.get('etag')).not.toBe(etagB);

    const headers = { host: 'app.localtest.me:3000', origin: 'http://app.localtest.me:3000', cookie: auth.cookie, 'content-type': 'application/x-www-form-urlencoded' };
    const restore = (releaseId: string, requestHeaders = headers, csrfToken = auth.csrfToken) => app.request(`http://app.localtest.me:3000/actions/releases/${releaseId}/activate`, { method: 'POST', headers: requestHeaders, body: form({ csrfToken }) });
    expect((await restore(releaseA.id, { ...headers, origin: 'http://evil.example' })).status).toBe(403);
    expect((await restore(releaseA.id, headers, 'wrong')).status).toBe(403);
    expect((await restore(releaseB.id)).status).toBe(409);

    const activeOperation = database.createSyncOperation(blog.userId, blog.id, { intent: 'content' });
    expect((await restore(releaseA.id)).status).toBe(409); expect(database.getActiveRelease(blog.id)?.id).toBe(releaseB.id);
    database.completeOperation(activeOperation.id);

    const missingRelease = database.activateRelease(blog.id, themeA.id, 1, join(releasesRoot, 'missing'));
    database.activateExistingRelease(releaseB.id, blog.id);
    const missing = await restore(missingRelease.id); expect(missing.status).toBe(409); expect(await missing.json()).toMatchObject({ error: { code: 'release_unavailable' } });
    const outside = join(root, 'outside-release'); await mkdir(outside); await writeFile(join(outside, 'index.html'), '<h1>Outside</h1>');
    const linkedArtifact = join(releasesRoot, 'linked'); await symlink(outside, linkedArtifact);
    const linkedRelease = database.activateRelease(blog.id, themeA.id, 1, linkedArtifact);
    database.activateExistingRelease(releaseB.id, blog.id);
    const linked = await restore(linkedRelease.id); expect(linked.status).toBe(409); expect(await linked.json()).toMatchObject({ error: { code: 'release_unavailable' } });

    const otherAuth = await register(app, 'release-outsider');
    expect((await restore(releaseA.id, { ...headers, cookie: otherAuth.cookie }, otherAuth.csrfToken)).status).toBe(404);
    const operationsBeforeRestore = database.connection.prepare('SELECT COUNT(*) AS count FROM operations').get() as { count: number };
    expect((await restore(releaseA.id)).status).toBe(303);
    expect(database.getActiveRelease(blog.id)?.id).toBe(releaseA.id);
    expect((database.connection.prepare('SELECT COUNT(*) AS count FROM operations').get() as { count: number }).count).toBe(operationsBeforeRestore.count);
    const publicA = await app.request('http://rollback.app.localtest.me:3000/', { headers: { host: 'rollback.app.localtest.me:3000', 'if-none-match': etagB } });
    expect(publicA.status).toBe(200); expect(publicA.headers.get('etag')).not.toBe(etagB); expect(await publicA.text()).toContain('Release A');
    const restoredEditor = await app.request('http://app.localtest.me:3000/editor', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    expect(await restoredEditor.text()).toContain('有未發布變更');
    expect((await restore(releaseB.id)).status).toBe(303); expect(database.getActiveRelease(blog.id)?.id).toBe(releaseB.id);
    database.close();
  });
  it('lets a user repair the initial HackMD source but locks it after successful sync', async () => {
    const { app, database } = await setup(); const auth = await register(app, 'recover');
    const headers = { host: 'app.localtest.me:3000', origin: 'http://app.localtest.me:3000', cookie: auth.cookie, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' };
    const first = await app.request('http://app.localtest.me:3000/actions/blog/connect', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, hackmdUsername: 'missing-source' }) });
    expect(first.status).toBe(202);
    const blog = database.getBlogForUser((await (await app.request('http://app.localtest.me:3000/api/session', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } })).json() as { user: { id: string } }).user.id);
    if (!blog) throw new Error('Blog missing');
    const active = database.getActiveOperation(blog.id, blog.userId); if (!active) throw new Error('Operation missing');
    const queued = await app.request(`http://app.localtest.me:3000/api/operations/${active.id}`, { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    expect(await queued.json()).toMatchObject({ status: 'queued', message: '正在等待同步…' });
    const statusPage = await app.request(`http://app.localtest.me:3000/operations/${active.id}`, { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    expect(await statusPage.text()).toContain('重新整理狀態');
    database.claimNextOperation();
    const running = await app.request(`http://app.localtest.me:3000/api/operations/${active.id}`, { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    expect(await running.json()).toMatchObject({ status: 'running', message: '正在讀取 HackMD 並建立預覽…' });
    database.failOperation(active.id, '找不到這個公開 HackMD 使用者'); database.failSync(blog.id, '找不到這個公開 HackMD 使用者');
    const onboarding = await app.request('http://app.localtest.me:3000/onboarding', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    expect(onboarding.status).toBe(200); expect(await onboarding.text()).toContain('missing-source');
    const retry = await app.request('http://app.localtest.me:3000/actions/blog/connect', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, hackmdUsername: 'correct-source' }) });
    expect(retry.status).toBe(202); expect(database.getBlog(blog.id)?.hackmdUsername).toBe('correct-source');
    const retryOperation = database.getActiveOperation(blog.id, blog.userId); if (!retryOperation) throw new Error('Retry operation missing');
    database.completeOperation(retryOperation.id); database.completeSync(blog.id, { title: 'Recovered', description: '', author: 'Recover', draftArtifact: '/tmp/draft' });
    expect((await app.request('http://app.localtest.me:3000/onboarding', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } })).status).toBe(302);
    const unpublished = await app.request('http://app.localtest.me:3000/editor', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    expect(await unpublished.text()).toContain('尚未發布');
    const locked = await app.request('http://app.localtest.me:3000/actions/blog/connect', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, hackmdUsername: 'another-source' }) });
    expect(locked.status).toBe(409); expect(await locked.json()).toMatchObject({ error: { code: 'source_locked' } });
    const syncedBlog = database.getBlog(blog.id); const liveTheme = database.getActiveTheme(blog.id); if (!syncedBlog || !liveTheme) throw new Error('Synced fixture missing');
    database.activateRelease(blog.id, liveTheme.id, syncedBlog.contentVersion, '/tmp/release');
    const live = await app.request('http://app.localtest.me:3000/editor', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    const liveHtml = await live.text(); expect(liveHtml).toContain('已與線上版本同步');
    const redundant = await app.request('http://app.localtest.me:3000/actions/publish', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, previewToken: previewToken(liveHtml) }) });
    expect(redundant.status).toBe(409); expect(await redundant.json()).toMatchObject({ error: { code: 'nothing_to_publish' } });
    database.createTheme(blog.id, { ...DEFAULT_THEME, description: 'Unpublished theme' }, 'change');
    const pending = await app.request('http://app.localtest.me:3000/editor', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    expect(await pending.text()).toContain('有未發布變更');
    database.close();
  });

  it('validates Blog identity changes and renders the last successful content summary', async () => {
    const { app, database } = await setup(); const auth = await register(app, 'identity');
    const sessionResponse = await app.request('http://app.localtest.me:3000/api/session', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    const userId = String((await sessionResponse.json() as { user: { id: string } }).user.id);
    const { blog, operation } = database.createBlog(userId, 'identity', 'identity-source'); database.completeOperation(operation.id);
    database.completeSync(blog.id, {
      title: 'Current title', description: 'Current description', author: 'Writer', draftArtifact: '/tmp/identity-draft', lastSyncedAt: '2026-07-20T10:00:00.000Z',
      contentManifest: [
        { title: 'Older article', slug: 'older', publishedAt: '2026-01-01T00:00:00.000Z' },
        { title: 'Newest article', slug: 'newest', publishedAt: '2026-07-19T00:00:00.000Z' },
      ],
    });
    const editor = await app.request('http://app.localtest.me:3000/editor', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    const html = await editor.text();
    expect(html).toContain('Blog 資訊'); expect(html).toContain('已匯入文章（2）'); expect(html.indexOf('Newest article')).toBeLessThan(html.indexOf('Older article'));
    expect(html).toContain('2026-07-20T10:00:00.000Z'); expect(html).not.toContain('private body');

    const headers = { host: 'app.localtest.me:3000', origin: 'http://app.localtest.me:3000', cookie: auth.cookie, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' };
    const invalid = await app.request('http://app.localtest.me:3000/actions/blog/identity', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, title: '', description: 'Description' }) });
    expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_blog_identity' } });
    const invalidOrigin = await app.request('http://app.localtest.me:3000/actions/blog/identity', { method: 'POST', headers: { ...headers, origin: 'http://evil.example' }, body: form({ csrfToken: auth.csrfToken, title: 'New title', description: 'New description' }) });
    expect(invalidOrigin.status).toBe(403); expect(await invalidOrigin.json()).toMatchObject({ error: { code: 'invalid_origin' } });
    const invalidCsrf = await app.request('http://app.localtest.me:3000/actions/blog/identity', { method: 'POST', headers, body: form({ csrfToken: 'wrong', title: 'New title', description: 'New description' }) });
    expect(invalidCsrf.status).toBe(403); expect(await invalidCsrf.json()).toMatchObject({ error: { code: 'invalid_csrf_token' } });

    const accepted = await app.request('http://app.localtest.me:3000/actions/blog/identity', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, title: '  New title  ', description: '  New description  ' }) });
    expect(accepted.status).toBe(202);
    const active = database.getActiveOperation(blog.id, blog.userId); if (!active) throw new Error('Identity operation missing');
    expect(active.payload).toEqual({ intent: 'identity', site: { title: 'New title', description: 'New description' } });
    expect((await (await app.request(`http://app.localtest.me:3000/api/operations/${active.id}`, { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } })).json() as { message: string }).message).toBe('正在等待更新 Blog 資訊…');
    const concurrent = await app.request('http://app.localtest.me:3000/actions/blog/identity', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, title: 'Another title', description: '' }) });
    expect(concurrent.status).toBe(409); expect(await concurrent.json()).toMatchObject({ error: { code: 'operation_in_progress' } });
    database.completeOperation(active.id);
    database.completeSync(blog.id, { title: 'New title', description: 'New description', author: 'Writer', draftArtifact: '/tmp/new-identity-draft' });
    const unchanged = await app.request('http://app.localtest.me:3000/actions/blog/identity', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, title: 'New title', description: 'New description' }) });
    expect(unchanged.status).toBe(409); expect(await unchanged.json()).toMatchObject({ error: { code: 'nothing_to_update' } });
    database.close();
  });

  it('previews curated controls without a revision, blocks unsaved publish, then saves one manual revision', async () => {
    const { app, database } = await setup(); const auth = await register(app, 'studio');
    const sessionResponse = await app.request('http://app.localtest.me:3000/api/session', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    const userId = String((await sessionResponse.json() as { user: { id: string } }).user.id);
    const { blog, operation } = database.createBlog(userId, 'studio', 'studio'); database.completeOperation(operation.id);
    database.completeSync(blog.id, { title: 'Studio', description: '', author: 'Studio', draftArtifact: '/tmp/studio-draft' });
    const editor = await app.request('http://app.localtest.me:3000/editor', { headers: { host: 'app.localtest.me:3000', cookie: auth.cookie } });
    const html = await editor.text(); const token = previewToken(html);
    expect(html).toContain('Theme Studio'); expect(html).toContain('更像一本克制的獨立雜誌'); expect(html.match(/name="palette"/g)).toHaveLength(6);
    const headers = { host: 'app.localtest.me:3000', origin: 'http://app.localtest.me:3000', cookie: auth.cookie, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' };
    const values = { csrfToken: auth.csrfToken, previewToken: token, ...studioControls };
    const preview = await app.request('http://app.localtest.me:3000/api/theme/preview', { method: 'POST', headers, body: form(values) });
    expect(preview.status).toBe(200); expect(await preview.json()).toMatchObject({ status: 'succeeded', message: '預覽已更新，尚未儲存' });
    expect(database.listThemes(blog.id)).toHaveLength(1);
    const access = await app.request(`http://preview.app.localtest.me:3000/preview-access/${token}`, { headers: { host: 'preview.app.localtest.me:3000' } });
    const previewCookie = access.headers.get('set-cookie')?.match(/vibelog_preview=[^;]+/)?.[0]; if (!previewCookie) throw new Error('Preview cookie missing');
    const css = await app.request('http://preview.app.localtest.me:3000/theme.css', { headers: { host: 'preview.app.localtest.me:3000', cookie: previewCookie } });
    expect(await css.text()).toContain('--theme-background: #f5f0e6');
    const blocked = await app.request('http://app.localtest.me:3000/actions/publish', { method: 'POST', headers, body: form({ csrfToken: auth.csrfToken, previewToken: token }) });
    expect(blocked.status).toBe(409); expect(await blocked.json()).toMatchObject({ error: { code: 'unsaved_theme' } });
    const saved = await app.request('http://app.localtest.me:3000/actions/theme/apply', { method: 'POST', headers, body: form(values) });
    expect(saved.status).toBe(303);
    expect(database.listThemes(blog.id)).toHaveLength(2);
    expect(database.getActiveTheme(blog.id)).toMatchObject({ source: 'manual', description: 'Editorial · Newsprint · Serif / Sans · Large' });
    const invalidOrigin = await app.request('http://app.localtest.me:3000/api/theme/preview', { method: 'POST', headers: { ...headers, origin: 'http://evil.example' }, body: form(values) });
    expect(invalidOrigin.status).toBe(403); expect(await invalidOrigin.json()).toMatchObject({ error: { code: 'invalid_origin' } });
    const invalidCsrf = await app.request('http://app.localtest.me:3000/api/theme/preview', { method: 'POST', headers, body: form({ ...values, csrfToken: 'wrong' }) });
    expect(invalidCsrf.status).toBe(403); expect(await invalidCsrf.json()).toMatchObject({ error: { code: 'invalid_csrf_token' } });
    const invalidControl = await app.request('http://app.localtest.me:3000/api/theme/preview', { method: 'POST', headers, body: form({ ...values, preset: 'unknown' }) });
    expect(invalidControl.status).toBe(400); expect(await invalidControl.json()).toMatchObject({ error: { code: 'invalid_theme_controls' } });
    const expired = await app.request('http://app.localtest.me:3000/api/theme/preview', { method: 'POST', headers, body: form({ ...values, previewToken: 'x'.repeat(43) }) });
    expect(expired.status).toBe(409); expect(await expired.json()).toMatchObject({ error: { code: 'preview_session_expired' } });

    const otherAuth = await register(app, 'outsider');
    const otherSession = await app.request('http://app.localtest.me:3000/api/session', { headers: { host: 'app.localtest.me:3000', cookie: otherAuth.cookie } });
    const otherUserId = String((await otherSession.json() as { user: { id: string } }).user.id);
    const otherBlog = database.createBlog(otherUserId, 'outsider', 'outsider'); database.completeOperation(otherBlog.operation.id);
    database.completeSync(otherBlog.blog.id, { title: 'Other', description: '', author: 'Other', draftArtifact: '/tmp/other-draft' });
    const crossUser = await app.request('http://app.localtest.me:3000/api/theme/preview', { method: 'POST', headers: { ...headers, cookie: otherAuth.cookie }, body: form({ ...values, csrfToken: otherAuth.csrfToken }) });
    expect(crossUser.status).toBe(409); expect(await crossUser.json()).toMatchObject({ error: { code: 'preview_session_expired' } });
    database.close();
  });
});
