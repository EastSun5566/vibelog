import { afterAll, describe, expect, it, vi } from 'vitest';
import { S3ArtifactStore } from '../src/adapters/s3-artifact-store.js';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { createApp } from '../src/index.js';

const config = loadAppConfig({
  APP_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://unused',
  BETTER_AUTH_SECRET: 'test-auth-secret-at-least-thirty-two-characters',
  OBJECT_STORE_ENDPOINT: 'http://localhost:9000',
  OBJECT_STORE_BUCKET: 'unused',
  OBJECT_STORE_ACCESS_KEY_ID: 'unused',
  OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
  EMAIL_PROVIDER: 'mailpit',
  MAILPIT_API_URL: 'http://localhost:8025',
  EMAIL_FROM: 'login@example.com',
});
const database = new AppDatabase(config.databaseUrl);
const send = vi.fn(() => Promise.resolve());
const consumeRateLimit = vi.spyOn(database, 'consumeRateLimit');
const { app } = createApp({
  config,
  database,
  artifactStore: new S3ArtifactStore(config.objectStore),
  emailSender: { sendMagicLink: send },
  dispatcher: { dispatch: () => Promise.resolve(0) },
});
afterAll(() => database.close());

describe('hosted edge enforcement', () => {
  const hosted = createApp({
    config: { ...config, edgeSharedSecret: 'test-edge-secret' },
    database,
    artifactStore: new S3ArtifactStore(config.objectStore),
    emailSender: { sendMagicLink: send },
    dispatcher: { dispatch: () => Promise.resolve(0) },
  }).app;

  it('rejects unsigned requests on every hosted surface before database access', async () => {
    const query = vi.spyOn(database.pool, 'query');
    try {
      for (const [host, path] of [
        ['localhost:3000', '/editor'],
        ['localhost:3000', '/api/agent/v1/context'],
        ['preview.localhost:3000', '/'],
        ['writer.localhost:3000', '/blog/post/'],
      ] as const) {
        const response = await hosted.request(path, { headers: { Host: host } });
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ error: { code: 'edge_identity_required' } });
      }
      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
  });

  it('keeps direct health probes checking the database', async () => {
    const ping = vi.spyOn(database, 'ping').mockResolvedValue();
    try {
      for (const method of ['GET', 'HEAD'])
        expect((await hosted.request('/health', { method })).status).toBe(200);
      expect(ping).toHaveBeenCalledTimes(2);
    } finally {
      ping.mockRestore();
    }
  });
});

describe('agent payload limit scope', () => {
  it('lets a large native article-selection form reach the existing browser auth guard', async () => {
    const body = new URLSearchParams();
    for (let index = 0; index < 1000; index++)
      body.set(`article:${String(index)}-${'long-article-title-'.repeat(4)}`, 'included');
    expect(new TextEncoder().encode(body.toString()).byteLength).toBeGreaterThan(64 * 1024);
    const response = await app.request('/actions/blog/selection', {
      method: 'POST',
      body,
      headers: { Host: 'localhost:3000' },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toMatch(/^\/auth\/login\?/u);
  });

  it('still rejects oversized agent payloads before authentication or JSON parsing', async () => {
    const response = await app.request('/api/agent/v1/design/validate', {
      method: 'POST',
      body: 'x'.repeat(64 * 1024 + 1),
      headers: { Host: 'localhost:3000', 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('lets selection lists for 1,000 long Unicode slugs reach authentication', async () => {
    const body = JSON.stringify({
      stateVersion: 'a'.repeat(43),
      excludedSlugs: Array.from(
        { length: 1000 },
        (_, index) => `${'文'.repeat(76)}${String(index).padStart(4, '0')}`,
      ),
    });
    const bytes = new TextEncoder().encode(body).byteLength;
    expect(bytes).toBeGreaterThan(64 * 1024);
    expect(bytes).toBeLessThan(256 * 1024);
    const response = await app.request('/api/agent/v1/selection', {
      method: 'POST',
      body,
      headers: { Host: 'localhost:3000', 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'agent_unauthorized' } });
  });

  it('still bounds selection payloads at 256 KiB, including streamed bodies', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const request = new Request('http://localhost:3000/api/agent/v1/selection', {
      method: 'POST',
      headers: { Host: 'localhost:3000', 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    const response = await app.request(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: 'payload_too_large', message: 'Request body exceeds 256 KiB' },
    });
  });
});

describe('authentication request limits', () => {
  it.each([
    '/auth/magic-link',
    '/auth/oauth/google',
    '/auth/logout',
    '/api/auth/sign-in/magic-link',
    '/api/auth/sign-in/social',
  ])('rejects oversized bodies at %s before authentication or email dispatch', async (path) => {
    const response = await app.request(path, {
      method: 'POST',
      body: 'x'.repeat(16 * 1024 + 1),
      headers: {
        Host: 'localhost:3000',
        'Content-Type': 'application/json',
        'Content-Length': String(16 * 1024 + 1),
      },
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('also limits streamed bodies without Content-Length', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8000));
        controller.enqueue(new Uint8Array(9000));
        controller.close();
      },
    });
    const request = new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { Host: 'localhost:3000', 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit);
    const response = await app.request(request);
    expect(response.status).toBe(413);
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts a body at the boundary for normal auth validation', async () => {
    const body = JSON.stringify({ email: 'invalid', padding: 'x'.repeat(16 * 1024 - 32) });
    expect(new TextEncoder().encode(body).byteLength).toBe(16 * 1024);
    const response = await app.request('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body,
      headers: { Host: 'localhost:3000', 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
