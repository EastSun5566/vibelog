import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
    database.activateRelease(blog.id, theme.id, release);
    const published = await app.request('http://alice.app.localtest.me:3000/', { headers: { host: 'alice.app.localtest.me:3000' } });
    expect(await published.text()).toContain('Published');
    expect(published.headers.get('content-security-policy')).toContain("script-src 'none'");
    expect((await app.request('http://unknown.example/', { headers: { host: 'unknown.example' } })).status).toBe(404);
    database.close();
  });
});
