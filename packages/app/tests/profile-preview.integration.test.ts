import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DESIGN_V2 } from '@vibelog/core';
import { eq, inArray } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppConfig } from '../src/config.js';
import { AppDatabase } from '../src/database.js';
import { createApp } from '../src/index.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';
import type { OperationMessage } from '../src/ports/operation-queue.js';
import { PREVIEW_TIMINGS, ProfilePreviewStore, previewNameKey } from '../src/profile-preview.js';
import { profilePreviews, rateLimit } from '../src/schema.js';

const url = process.env.TEST_DATABASE_URL;
const contentProfile = {
  postCount: 1,
  tagCount: 0,
  averageLength: 'short',
  codeUsage: 'none',
  imageUsage: 'none',
  mathUsage: 'none',
} as const;
const DRAFT_ONE = randomUUID();
const KEPT_DRAFT = randomUUID();
const result = (draft: string) => ({
  sourceArtifactId: randomUUID(),
  draftArtifactId: draft,
  design: DEFAULT_DESIGN_V2,
  designSource: 'preset' as const,
  title: "Alice's blog",
  author: 'Alice',
  contentProfile,
});

describe.skipIf(!url)('anonymous profile previews', () => {
  const database = new AppDatabase(url ?? 'postgresql://unused');
  const store = new ProfilePreviewStore(database);
  const names: string[] = [];
  const name = () => {
    const value = `Preview-${randomUUID().slice(0, 8)}`;
    names.push(previewNameKey(value));
    return value;
  };
  beforeAll(async () => {
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL('../src/drizzle', import.meta.url)),
    });
  });
  beforeEach(async () => {
    await database.db.delete(rateLimit).where(eq(rateLimit.key, 'preview-global'));
  });
  afterAll(async () => {
    if (names.length > 0)
      await database.db.delete(profilePreviews).where(inArray(profilePreviews.nameKey, names));
    await database.db.delete(rateLimit).where(eq(rateLimit.key, 'preview-global'));
    await database.close();
  });

  it('creates one shared job per profile and lets one worker claim it', async () => {
    const hackmd = name();
    const [first, second] = await Promise.all([store.create(hackmd), store.create(hackmd)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const created = first ?? second;
    if (!created) throw new Error('Preview was not created');
    expect(created).toMatchObject({ state: 'queued', generation: 1, hackmdUsername: hackmd });
    const claims = await Promise.all([store.claim(created.id), store.claim(created.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('completes, refreshes and hands back the superseded build', async () => {
    const created = await store.create(name());
    if (!created) throw new Error('Preview was not created');
    const lease = await store.claim(created.id);
    if (!lease) throw new Error('Preview was not claimed');
    await store.setStage(lease, 'Building your blog');
    expect(await store.complete(lease, result(DRAFT_ONE))).toEqual([]);
    const ready = await store.get(created.nameKey);
    expect(ready).toMatchObject({ state: 'ready', draftArtifactId: DRAFT_ONE, stage: null });
    expect(Date.parse(ready?.expiresAt ?? '') - Date.parse(ready?.generatedAt ?? '')).toBe(
      PREVIEW_TIMINGS.ttlSeconds * 1000,
    );
    if (!ready) throw new Error('Preview is missing');
    const [refreshed, raced] = await Promise.all([store.refresh(ready), store.refresh(ready)]);
    expect([refreshed, raced].filter(Boolean)).toHaveLength(1);
    const next = await store.claim(created.id);
    if (!next) throw new Error('Refresh was not claimed');
    expect(next.generation).toBe(2);
    // A stale worker from generation 1 can no longer write.
    await expect(store.setStage(lease, 'late')).rejects.toThrow('lease');
    const superseded = await store.complete(next, result(randomUUID()));
    expect(superseded).toContain(DRAFT_ONE);
  });

  it('keeps the last good build when a refresh fails, and requeues abandoned work', async () => {
    const created = await store.create(name());
    if (!created) throw new Error('Preview was not created');
    const lease = await store.claim(created.id);
    if (!lease) throw new Error('Preview was not claimed');
    await store.complete(lease, result(KEPT_DRAFT));
    const ready = await store.get(created.nameKey);
    if (!ready) throw new Error('Preview is missing');
    const refreshed = await store.refresh(ready);
    if (!refreshed) throw new Error('Refresh failed');
    const retry = await store.claim(created.id);
    if (!retry) throw new Error('Refresh was not claimed');
    await store.fail(retry, 'HackMD is not responding reliably right now.');
    expect(await store.get(created.nameKey)).toMatchObject({
      state: 'failed',
      draftArtifactId: KEPT_DRAFT,
    });

    const abandoned = await store.create(name());
    if (!abandoned) throw new Error('Preview was not created');
    const stale = await store.claim(abandoned.id, new Date(Date.now() - 60 * 60_000));
    if (!stale) throw new Error('Preview was not claimed');
    expect(await store.nextQueued()).not.toBeNull();
    expect(await store.requeue(stale)).toBe(true);
    expect((await store.get(abandoned.nameKey))?.state).toBe('queued');
  });

  it('serves /@name as a noindex page and its build from an isolated preview host', async () => {
    const config = loadAppConfig({
      APP_ORIGIN: 'http://app.localtest.me:3000',
      DATABASE_URL: url ?? 'postgresql://unused',
      BETTER_AUTH_SECRET: 'test-auth-secret-at-least-thirty-two-characters',
      OBJECT_STORE_ENDPOINT: 'http://localhost:9000',
      OBJECT_STORE_BUCKET: 'unused',
      OBJECT_STORE_ACCESS_KEY_ID: 'unused',
      OBJECT_STORE_SECRET_ACCESS_KEY: 'unused',
      EMAIL_PROVIDER: 'mailpit',
      MAILPIT_API_URL: 'http://localhost:8025',
      EMAIL_FROM: 'login@example.com',
      VIBELOG_PREVIEW_GLOBAL_DAILY_LIMIT: '1',
    });
    const enqueue = vi.fn<(message: OperationMessage) => Promise<void>>(() => Promise.resolve());
    const readObject = vi.fn<ArtifactStore['readObject']>((_id, path) =>
      Promise.resolve(
        path === 'index.html'
          ? { body: new Blob(['<h1>Alice</h1>']).stream(), contentType: 'text/html; charset=utf-8' }
          : null,
      ),
    );
    const { app } = createApp({
      config,
      database,
      artifactStore: { readObject } as unknown as ArtifactStore,
      emailSender: { sendMagicLink: () => Promise.resolve() },
      dispatcher: { dispatch: () => Promise.resolve(0) },
      previewQueue: { enqueue },
    });
    const visit = (path: string, host = 'app.localtest.me:3000') =>
      app.request(`http://app.localtest.me:3000${path}`, { headers: { host } });

    const hackmd = name();
    const first = await visit(`/@${hackmd}`);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    const pending = await first.text();
    expect(pending).toContain(`Building @${hackmd}`);
    expect(pending).toContain('http-equiv="refresh"');
    expect(enqueue).toHaveBeenCalledTimes(1);
    await visit(`/@${hackmd.toUpperCase()}`);
    expect(enqueue).toHaveBeenCalledTimes(1);

    // The daily cap allows one new profile here, so the next unknown name waits.
    const limited = await visit(`/@${name()}`);
    expect(limited.status).toBe(429);
    expect(await limited.text()).toContain('Too many new previews');
    expect(enqueue).toHaveBeenCalledTimes(1);

    const created = await store.get(previewNameKey(hackmd));
    const lease = created && (await store.claim(created.id));
    if (!lease) throw new Error('Preview was not claimed');
    await store.complete(lease, result(randomUUID()));
    const ready = await visit(`/@${hackmd}`);
    const host = `${lease.label}.app.localtest.me:3000`;
    expect(await ready.text()).toContain(`src="http://${host}/"`);
    expect(ready.headers.get('content-security-policy')).toContain(`frame-src`);
    expect(ready.headers.get('content-security-policy')).toContain(`http://${host}`);

    const site = await visit('/', host);
    expect(site.status).toBe(200);
    expect(site.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(site.headers.get('content-security-policy')).toContain(
      'frame-ancestors http://app.localtest.me:3000',
    );
    expect(await site.text()).toBe('<h1>Alice</h1>');
    const css = await visit('/design.css', host);
    expect(css.headers.get('content-type')).toContain('text/css');

    expect((await visit('/@a%2Fb')).status).toBe(404);
    expect((await visit('/', 'try-000000000000.app.localtest.me:3000')).status).toBe(404);
  });
});
