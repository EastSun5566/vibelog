import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq, inArray, like } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emailRateLimitKey } from '../src/auth.js';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { createApp } from '../src/index.js';
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';
import type { TransactionalEmailSender } from '../src/ports/transactional-email.js';
import { rateLimit, user, verification } from '../src/schema.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('magic-link admission', () => {
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
    const verified = await app.request(link, { headers });
    expect(verified.status).toBe(302);
    expect(verified.headers.get('Location')).toBe(`${config.appOrigin}/editor`);
    expect(verified.headers.getSetCookie().join(';')).toContain('vibelog.session_token=');
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
