import { afterAll, describe, expect, it } from 'vitest';
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { createApp } from '../src/index.js';

const config = loadAppConfig({
  APP_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'postgresql://unused',
  BETTER_AUTH_SECRET: 'test-auth-secret-at-least-thirty-two-characters',
  OBJECT_STORE_ENDPOINT: 'http://localhost:9000', OBJECT_STORE_BUCKET: 'unused',
  OBJECT_STORE_ACCESS_KEY_ID: 'unused', OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
  EMAIL_PROVIDER: 'mailpit', MAILPIT_API_URL: 'http://localhost:8025', EMAIL_FROM: 'login@example.com',
});
const database = new AppDatabase(config.databaseUrl);
const { app } = createApp({
  config, database, artifactStore: new S3ArtifactStore(config.objectStore),
  emailSender: { sendMagicLink: () => Promise.resolve() }, dispatcher: { dispatch: () => Promise.resolve(0) },
});
afterAll(() => database.close());

describe('agent payload limit scope', () => {
  it('lets a large native article-selection form reach the existing browser auth guard', async () => {
    const body = new URLSearchParams();
    for (let index = 0; index < 1000; index++) body.set(`article:${String(index)}-${'long-article-title-'.repeat(4)}`, 'included');
    expect(new TextEncoder().encode(body.toString()).byteLength).toBeGreaterThan(64 * 1024);
    const response = await app.request('/actions/blog/selection', { method: 'POST', body, headers: { Host: 'localhost:3000' } });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toMatch(/^\/auth\/login\?/u);
  });

  it('still rejects oversized agent payloads before authentication or JSON parsing', async () => {
    const response = await app.request('/api/agent/v1/design/validate', {
      method: 'POST', body: 'x'.repeat(64 * 1024 + 1), headers: { Host: 'localhost:3000', 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });
});
