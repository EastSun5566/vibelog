import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { createApp } from '../src/index.js';
import { account, session, user } from '../src/schema.js';
import {
  authForm,
  login,
  makeTestApp,
  register,
  responseCookie,
  TEST_ORIGIN,
  TEST_PASSWORD,
  testConfig,
} from './helpers.js';

describe('self-contained Better Auth integration', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vibelog-auth-'));
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Auth tests must not make external requests');
    }));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  });

  it('requires only the local Better Auth secret and valid quota configuration', () => {
    expect(() => loadAppConfig({ NODE_ENV: 'test' })).toThrow('BETTER_AUTH_SECRET is required');
    expect(() => testConfig(root, { BETTER_AUTH_SECRET: 'too-short' })).toThrow('BETTER_AUTH_SECRET must be at least 32 characters');
    expect(() => testConfig(root, { VIBELOG_AI_USER_DAILY_LIMIT: '0' })).toThrow('must be a positive integer');
  });

  it('registers a lowercase UUID user with a hidden synthetic email and signs in immediately', async () => {
    const instance = makeTestApp(root);
    try {
      const identity = await register(instance, { username: 'Alice' });
      expect(identity.response.headers.get('location')).toBe('/projects');
      const setCookie = identity.response.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('vibelog.session_token=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).not.toContain(TEST_PASSWORD);

      const row = instance.database.db.select().from(user).get();
      expect(row).toMatchObject({ username: 'alice', email: 'alice@users.vibelog.invalid', emailVerified: false });
      expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
      const credential = instance.database.db.select().from(account).get();
      expect(credential?.password).toBeTruthy();
      expect(credential?.password).not.toContain(TEST_PASSWORD);

      const sessionResponse = await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie: identity.cookie } });
      const sessionBody = await sessionResponse.json() as Record<string, unknown>;
      expect(sessionBody).toMatchObject({ user: { id: row?.id, username: 'alice' } });
      expect(JSON.stringify(sessionBody)).not.toContain('@users.vibelog.invalid');
      expect(JSON.stringify(sessionBody)).not.toContain(TEST_PASSWORD);

      const duplicate = await instance.app.request(`${TEST_ORIGIN}/auth/register`, authForm({ username: 'ALICE', password: TEST_PASSWORD }, TEST_ORIGIN, '192.0.2.2'));
      expect(duplicate.status).toBe(400);
      expect(await duplicate.text()).not.toContain('@users.vibelog.invalid');
      const invalid = await instance.app.request(`${TEST_ORIGIN}/auth/register`, authForm({ username: 'bad name', password: TEST_PASSWORD }, TEST_ORIGIN, '192.0.2.3'));
      expect(invalid.status).toBe(400);
      expect(instance.database.db.select().from(user).all()).toHaveLength(1);
    } finally {
      instance.database.close();
    }
  });

  it('accepts username login only and keeps Better Auth endpoints private', async () => {
    const instance = makeTestApp(root);
    try {
      const registered = await register(instance);
      const signedIn = await login(instance, 'ALICE');
      expect(signedIn.status).toBe(303);
      expect(signedIn.headers.get('location')).toBe('/projects');
      const cookie = responseCookie(signedIn);

      const emailLogin = await login(instance, 'alice@users.vibelog.invalid');
      expect(emailLogin.status).toBe(401);
      expect(await emailLogin.text()).toContain('Invalid username or password');
      expect((await instance.app.request(`${TEST_ORIGIN}/auth/forgot-password`)).status).toBe(404);
      expect((await instance.app.request(`${TEST_ORIGIN}/auth/reset-password`)).status).toBe(404);
      expect((await instance.app.request(`${TEST_ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'alice@users.vibelog.invalid', password: TEST_PASSWORD }),
      })).status).toBe(401);
      expect((await instance.app.request(`${TEST_ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { cookie, origin: TEST_ORIGIN, 'content-type': 'application/json' },
        body: '{}',
      })).status).toBe(404);

      const storedSession = instance.database.db.select().from(session).get();
      expect(storedSession?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 60 * 60 * 1000);
      expect(storedSession?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 12 * 60 * 60 * 1000);
      instance.database.db.update(session).set({ expiresAt: new Date(0) }).run();
      expect((await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie: registered.cookie } })).status).toBe(401);
    } finally {
      instance.database.close();
    }
  });

  it('uses generalized login errors and rejects an untrusted origin', async () => {
    const instance = makeTestApp(root);
    try {
      await register(instance);
      const wrongPassword = await login(instance, 'alice', 'incorrect-password');
      expect(wrongPassword.status).toBe(401);
      expect(await wrongPassword.text()).toContain('Invalid username or password');
      const wrongUser = await login(instance, 'unknown', TEST_PASSWORD);
      expect(wrongUser.status).toBe(401);
      expect(await wrongUser.text()).toContain('Invalid username or password');
      expect((await login(instance, 'alice', TEST_PASSWORD, 'https://evil.test')).status).toBe(403);
    } finally {
      instance.database.close();
    }
  });

  it('changes the password with origin and CSRF checks and revokes other sessions', async () => {
    const instance = makeTestApp(root);
    try {
      const registered = await register(instance);
      const secondLogin = await login(instance);
      const secondCookie = responseCookie(secondLogin);
      const sessionResponse = await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie: secondCookie } });
      const { csrfToken } = await sessionResponse.json() as { csrfToken: string };
      const change = (values: Record<string, string>, cookie = secondCookie, origin = TEST_ORIGIN) => instance.app.request(
        `${TEST_ORIGIN}/auth/change-password`,
        { ...authForm(values, origin), headers: { ...authForm(values, origin).headers, cookie } },
      );

      expect((await change({ currentPassword: TEST_PASSWORD, newPassword: 'a-new-correct-horse-password', csrfToken: 'wrong' })).status).toBe(403);
      expect((await change({ currentPassword: TEST_PASSWORD, newPassword: 'a-new-correct-horse-password', csrfToken }, secondCookie, 'https://evil.test')).status).toBe(403);
      const wrongCurrent = await change({ currentPassword: 'incorrect-password', newPassword: 'a-new-correct-horse-password', csrfToken });
      expect(wrongCurrent.status).toBe(400);
      expect(await wrongCurrent.text()).toContain('Current password is incorrect');

      const changed = await change({ currentPassword: TEST_PASSWORD, newPassword: 'a-new-correct-horse-password', csrfToken });
      expect(changed.status).toBe(200);
      expect(await changed.text()).toContain('其他登入 session 已撤銷');
      const newCookie = responseCookie(changed);
      expect((await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie: registered.cookie } })).status).toBe(401);
      expect((await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie: secondCookie } })).status).toBe(401);
      expect((await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie: newCookie } })).status).toBe(200);
      expect((await login(instance, 'alice', TEST_PASSWORD, TEST_ORIGIN, '192.0.2.2')).status).toBe(401);
      expect((await login(instance, 'alice', 'a-new-correct-horse-password', TEST_ORIGIN, '192.0.2.3')).status).toBe(303);
    } finally {
      instance.database.close();
    }
  });

  it('enforces per-IP signup, login, and password-change rate limits', async () => {
    const instance = makeTestApp(root);
    try {
      for (let index = 0; index < 3; index += 1) {
        const response = await instance.app.request(`${TEST_ORIGIN}/auth/register`, authForm({ username: `rate_${String(index)}`, password: TEST_PASSWORD }, TEST_ORIGIN, '192.0.2.10'));
        expect(response.status).toBe(303);
      }
      expect((await instance.app.request(`${TEST_ORIGIN}/auth/register`, authForm({ username: 'rate_3', password: TEST_PASSWORD }, TEST_ORIGIN, '192.0.2.10'))).status).toBe(429);

      for (let index = 0; index < 10; index += 1) {
        expect((await login(instance, 'missing', TEST_PASSWORD, TEST_ORIGIN, '192.0.2.11')).status).toBe(401);
      }
      expect((await login(instance, 'missing', TEST_PASSWORD, TEST_ORIGIN, '192.0.2.11')).status).toBe(429);

      const signedIn = await login(instance, 'rate_0', TEST_PASSWORD, TEST_ORIGIN, '192.0.2.12');
      const cookie = responseCookie(signedIn);
      const sessionResponse = await instance.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie } });
      const { csrfToken } = await sessionResponse.json() as { csrfToken: string };
      for (let index = 0; index < 5; index += 1) {
        const attempt = authForm({ currentPassword: 'wrong-password', newPassword: 'another-correct-horse-password', csrfToken }, TEST_ORIGIN, '192.0.2.12');
        expect((await instance.app.request(`${TEST_ORIGIN}/auth/change-password`, { ...attempt, headers: { ...attempt.headers, cookie } })).status).toBe(400);
      }
      const limited = authForm({ currentPassword: 'wrong-password', newPassword: 'another-correct-horse-password', csrfToken }, TEST_ORIGIN, '192.0.2.12');
      expect((await instance.app.request(`${TEST_ORIGIN}/auth/change-password`, { ...limited, headers: { ...limited.headers, cookie } })).status).toBe(429);
    } finally {
      instance.database.close();
    }
  });

  it('invalidates signed session cookies after BETTER_AUTH_SECRET rotation', async () => {
    const database = new AppDatabase(root);
    try {
      const first = createApp({ config: testConfig(root), database });
      const registration = await first.app.request(`${TEST_ORIGIN}/auth/register`, authForm({ username: 'rotate', password: TEST_PASSWORD }));
      const cookie = responseCookie(registration);
      expect((await first.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie } })).status).toBe(200);

      const rotated = createApp({ config: testConfig(root, { BETTER_AUTH_SECRET: 'rotated-secret-that-is-at-least-thirty-two-chars' }), database });
      expect((await rotated.app.request(`${TEST_ORIGIN}/api/session`, { headers: { cookie } })).status).toBe(401);
      expect(database.db.select().from(session).all()).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
