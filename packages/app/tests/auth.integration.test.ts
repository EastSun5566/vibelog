import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, inArray, like } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emailRateLimitKey } from '../src/auth.js';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { createApp } from '../src/index.js';
import { hashToken } from '../src/security/crypto.js';
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';
import type { TransactionalEmailSender } from '../src/ports/transactional-email.js';
import { account, blogs, rateLimit, session, user, verification } from '../src/schema.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('browser authentication', () => {
  const config = loadAppConfig({
    APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: url ?? 'postgresql://unused',
    BETTER_AUTH_SECRET: 'auth-test-secret-at-least-thirty-two-characters',
    OBJECT_STORE_ENDPOINT: 'http://localhost:9000', OBJECT_STORE_BUCKET: 'unused',
    OBJECT_STORE_ACCESS_KEY_ID: 'unused', OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
    EMAIL_PROVIDER: 'mailpit', MAILPIT_API_URL: 'http://localhost:8025', EMAIL_FROM: 'login@example.com',
  });
  const database = new AppDatabase(config.databaseUrl);
  const secondDatabase = new AppDatabase(config.databaseUrl);
  const send = vi.fn<TransactionalEmailSender['sendMagicLink']>(() => Promise.resolve());
  const makeApp = (db: AppDatabase) => createApp({ config, database: db, artifactStore: new S3ArtifactStore(config.objectStore), emailSender: { sendMagicLink: send }, dispatcher: { dispatch: () => Promise.resolve(0) } }).app;
  const app = makeApp(database);
  const secondApp = makeApp(secondDatabase);
  const emails: string[] = [];
  const email = () => { const value = `${randomUUID()}@example.com`; emails.push(value); return value; };
  const headers = { Host: 'localhost:3000', Origin: config.appOrigin };
  const raw = (address: string, target = app, path = '/api/auth/sign-in/magic-link') => target.request(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: address, callbackURL: '/editor' }) });
  const native = (address: string) => app.request('/auth/magic-link', { method: 'POST', headers, body: new URLSearchParams({ email: address, returnTo: '/editor' }) });
  const verificationCount = async (address: string) => (await database.db.select().from(verification).where(like(verification.value, `%${address}%`))).length;
  const signIn = async (address: string) => {
    expect((await raw(address)).status).toBe(200);
    const link = send.mock.calls.find(([input]) => input.to === address)?.[0].url;
    if (!link) throw new Error('Missing local test sign-in link');
    const response = await app.request(link, { headers });
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('vibelog.session_token='))?.split(';')[0];
    if (!cookie) throw new Error('Missing local test session cookie');
    return { link, cookie };
  };
  beforeAll(() => migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../src/drizzle', import.meta.url)) }));
  afterAll(async () => {
    for (const address of emails) {
      const key = emailRateLimitKey(config.betterAuthSecret, address);
      await database.db.delete(rateLimit).where(inArray(rateLimit.key, [`magic:minute:${key}`, `magic:hour:${key}`]));
      await database.db.delete(verification).where(like(verification.value, `%${address}%`));
      await database.db.delete(user).where(eq(user.email, address));
    }
    await Promise.all([database.close(), secondDatabase.close()]);
  });

  it('shares the native form limit with the raw endpoint before creating tokens or sending mail', async () => {
    const address = email();
    expect((await native(address)).status).toBe(303);
    expect((await raw(` ${address.toUpperCase()} `)).status).toBe(429);
    expect((await raw(address, app, '/api/auth/sign-in/magic-link/')).status).toBe(404);
    const rejected = await native(address);
    expect(rejected.status).toBe(429);
    expect(await rejected.text()).toContain('Please wait before requesting another link.');
    expect(await verificationCount(address)).toBe(1);
    const deliveries = send.mock.calls.filter(([input]) => input.to === address);
    expect(deliveries).toHaveLength(1);
    const link = deliveries[0]?.[0].url;
    if (!link) throw new Error('Missing local test sign-in link');
    const token = new URL(link).searchParams.get('token');
    if (!token) throw new Error('Missing local test token');
    const [stored] = await database.db.select().from(verification).where(like(verification.value, `%${address}%`));
    expect(stored?.identifier).toBe(createHash('sha256').update(token).digest('base64url'));
    expect(stored?.identifier).not.toBe(token);
    const verified = await app.request(link, { headers });
    expect(verified.status).toBe(302);
    expect(verified.headers.get('Location')).toBe(`${config.appOrigin}/editor`);
    expect(verified.headers.getSetCookie().join(';')).toContain('vibelog.session_token=');
    expect(verified.headers.get('Cache-Control')).toBe('private, no-store');
    const replay = await app.request(link, { headers });
    expect(replay.headers.get('Location')).toContain('error=INVALID_TOKEN');
    expect(replay.headers.getSetCookie().join(';')).not.toContain('vibelog.session_token=');
  });

  it('rejects expired links and previously issued plaintext links without creating a session', async () => {
    for (const legacy of [false, true]) {
      const address = email();
      expect((await raw(address)).status).toBe(200);
      const link = send.mock.calls.find(([input]) => input.to === address)?.[0].url;
      if (!link) throw new Error('Missing local test link');
      const token = new URL(link).searchParams.get('token');
      if (!token) throw new Error('Missing local test token');
      await database.db.update(verification).set(legacy ? { identifier: token } : { expiresAt: new Date(Date.now() - 1000) }).where(like(verification.value, `%${address}%`));
      const response = await app.request(link, { headers });
      expect(response.headers.get('Location')).toContain('error=INVALID_TOKEN');
      expect(response.headers.getSetCookie().join(';')).not.toContain('vibelog.session_token=');
      expect(await database.db.select().from(user).where(eq(user.email, address))).toHaveLength(0);
    }
  });

  it.each(['draft_not_ready', 'operation_in_progress'] as const)('returns a friendly 409 for browser publishing with %s', async (conflict) => {
    const address = email(); const { cookie } = await signIn(address);
    const info = await (await app.request('/api/session', { headers: { ...headers, Cookie: cookie } })).json() as { user: { id: string }; csrfToken: string };
    const { blog, operation } = await database.createBlog(info.user.id, `browser-${info.user.id.slice(0, 8)}`, 'writer');
    const lease = await database.claimOperation(operation.id); const design = await database.getActiveDesign(blog.id);
    if (!lease || !design) throw new Error('Missing test sync or design');
    const source = await database.createArtifact(blog.id, 'source'); const draft = await database.createArtifact(blog.id, 'draft');
    await database.completeSyncOperation(lease, {
      title: 'Writer', description: '', author: 'Writer', sourceArtifactId: source.id, draftArtifactId: draft.id, designRevisionId: design.id,
      contentProfile: { postCount: 0, tagCount: 0, averageLength: 'short', codeUsage: 'none', imageUsage: 'none', mathUsage: 'none' },
    }, {});
    const previewToken = randomUUID();
    await database.createPreviewSession(hashToken(previewToken), info.user.id, blog.id, '2099-01-01', design.config);
    if (conflict === 'draft_not_ready') await database.db.update(blogs).set({ draftDesignRevisionId: null }).where(eq(blogs.id, blog.id));
    else await database.createSyncOperation(info.user.id, blog.id, {});
    const response = await app.request('/actions/publish', {
      method: 'POST', headers: { ...headers, Cookie: cookie, Accept: 'application/json' },
      body: new URLSearchParams({ csrfToken: info.csrfToken, previewToken }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toHaveProperty('error.code', conflict === 'draft_not_ready' ? 'preview_not_ready' : conflict);
    expect(await database.getActiveRelease(blog.id)).toBeNull();
  });

  it('refreshes an aged session and forwards its cookie, without rewriting fresh sessions', async () => {
    const address = email();
    const { cookie } = await signIn(address);
    const [owner] = await database.db.select().from(user).where(eq(user.email, address));
    if (!owner) throw new Error('Missing test user');
    const snapshot = async () => (await database.db.select().from(session).where(eq(session.userId, owner.id)))[0];
    const initial = await snapshot();
    for (const path of ['/api/session', '/', '/guide', '/auth/login']) {
      const response = await app.request(path, { headers: { ...headers, Cookie: cookie } });
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(await snapshot()).toEqual(initial);
    await database.db.update(session).set({ expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000), updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }).where(eq(session.userId, owner.id));
    const response = await app.request('/api/session', { headers: { ...headers, Cookie: cookie } });
    expect(response.status).toBe(200);
    const refreshedCookie = response.headers.getSetCookie().find((value) => value.startsWith('vibelog.session_token='));
    expect(refreshedCookie).toContain('Max-Age=43200');
    expect(refreshedCookie).toContain('HttpOnly');
    expect(refreshedCookie).toContain('SameSite=Lax');
    const refreshed = await snapshot();
    expect(refreshed?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 60 * 60 * 1000);
    expect(refreshed?.updatedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    const next = await app.request('/api/session', { headers: { ...headers, Cookie: cookie } });
    expect(next.headers.getSetCookie()).toEqual([]);
    expect(await snapshot()).toEqual(refreshed);
    const data = await next.json() as { csrfToken: string };
    const logout = await app.request('/auth/logout', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: new URLSearchParams({ csrfToken: data.csrfToken }) });
    expect(logout.status).toBe(303);
    expect(logout.headers.getSetCookie().join(';')).toContain('Max-Age=0');
    expect(await snapshot()).toBeUndefined();
    const revoked = await app.request('/api/session', { headers: { ...headers, Cookie: cookie } });
    expect(revoked.status).toBe(302);
    expect(revoked.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('expires sessions and forwards the clearing cookie', async () => {
    const address = email();
    const { cookie } = await signIn(address);
    const [owner] = await database.db.select().from(user).where(eq(user.email, address));
    if (!owner) throw new Error('Missing test user');
    await database.db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.userId, owner.id));
    const response = await app.request('/api/session', { headers: { ...headers, Cookie: cookie } });
    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie().join(';')).toContain('vibelog.session_token=; Max-Age=0');
  });

  it.each(['/auth/login', '/editor', '/onboarding', '/api/session', '/api/operations/unknown', '/operations/unknown', '/account/agents', '/agent/authorize', '/', '/guide'])('does not cache unauthenticated private responses at %s', async (path) => {
    const response = await app.request(path, { headers });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it.each(['google', 'github'] as const)('links %s accounts only when both email addresses are verified', async (providerId) => {
    const configured = createApp({ config: { ...config, googleClientId: 'test-google', googleClientSecret: 'test-google-secret', githubClientId: 'test-github', githubClientSecret: 'test-github-secret' }, database, artifactStore: new S3ArtifactStore(config.objectStore), emailSender: { sendMagicLink: send }, dispatcher: { dispatch: () => Promise.resolve(0) } });
    const context = await configured.auth.$context;
    const provider = context.socialProviders.find((item) => item.id === providerId);
    if (!provider) throw new Error('Missing test OAuth provider');
    for (const [localVerified, providerVerified] of [[true, false], [false, true], [true, true]] as const) {
      const address = email();
      const [owner] = await database.db.insert(user).values({ email: address, name: 'Test user', emailVerified: localVerified }).returning();
      if (!owner) throw new Error('Missing test user');
      const accountId = randomUUID();
      const tokens = vi.spyOn(provider, 'validateAuthorizationCode').mockResolvedValue({ accessToken: 'local-test-token', scopes: [] });
      const info = vi.spyOn(provider, 'getUserInfo').mockResolvedValue({ user: { id: accountId, name: 'Test user', email: address, emailVerified: providerVerified }, data: {} });
      try {
        const start = await configured.app.request('/api/auth/sign-in/social', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: providerId, callbackURL: '/editor' }) });
        expect(start.status).toBe(200);
        const result = await start.json() as { url: string };
        const state = new URL(result.url).searchParams.get('state');
        if (!state) throw new Error('Missing OAuth state');
        const cookie = start.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
        const callback = await configured.app.request(`/api/auth/callback/${providerId}?code=test-code&state=${encodeURIComponent(state)}`, { headers: { ...headers, Cookie: cookie } });
        const linked = await database.db.select().from(account).where(eq(account.userId, owner.id));
        if (localVerified && providerVerified) {
          expect(callback.headers.get('Location')).toBe('/editor');
          expect(linked).toMatchObject([{ providerId, accountId }]);
          expect(callback.headers.getSetCookie().join(';')).toContain('vibelog.session_token=');
        } else {
          expect(callback.headers.get('Location')).toContain('account_not_linked');
          expect(linked).toHaveLength(0);
          expect(callback.headers.getSetCookie().join(';')).not.toContain('vibelog.session_token=');
        }
      } finally { tokens.mockRestore(); info.mockRestore(); }
    }
  });

  it('allows only one concurrent request across app instances and normalizes the recipient', async () => {
    const address = email();
    const responses = await Promise.all([raw(address), raw(address.toUpperCase(), secondApp)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 429]);
    expect((await native(address)).status).toBe(429);
    expect(await verificationCount(address)).toBe(1);
    expect(send.mock.calls.filter(([input]) => input.to === address)).toHaveLength(1);
  });

  it('preserves the hourly limit after the minute window resets', async () => {
    const address = email();
    const key = emailRateLimitKey(config.betterAuthSecret, address);
    for (let attempt = 0; attempt < 4; attempt++) {
      await database.db.update(rateLimit).set({ lastRequest: Math.floor(Date.now() / 1000) - 61 }).where(eq(rateLimit.key, `magic:minute:${key}`));
      expect((await raw(address)).status).toBe(attempt < 3 ? 200 : 429);
    }
    expect(await verificationCount(address)).toBe(3);
    expect(send.mock.calls.filter(([input]) => input.to === address)).toHaveLength(3);
  });
});
