import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { DEFAULT_THEME } from '@vibelog/core';
import { AppDatabase, MAX_OPERATION_ATTEMPTS, OperationLeaseLostError } from '../src/database.js';
import { AppOperationExecutor, OutboxDispatcher, RetryableOperationError } from '../src/jobs.js';
import { loadWorkerConfig } from '../src/config.js';
import { smokeWorker } from '../scripts/worker-smoke.js';
import { CloudTasksRequestVerifier } from '../src/adapters/cloud-tasks-request-verifier.js';
import { handleOperationTask } from '../src/adapters/cloud-tasks-transport.js';
import { operations, rateLimit, user } from '../src/schema.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('PostgreSQL operation repository', () => {
  const database = new AppDatabase(url ?? 'postgresql://unused');
  const userId = randomUUID();
  const rateKey = `magic:${randomUUID()}`;
  beforeAll(async () => { await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../src/drizzle', import.meta.url)) }); await database.db.insert(user).values({ id: userId, name: 'Writer', email: `${userId}@example.com` }); });
  afterAll(async () => { await database.db.delete(user).where(eq(user.id, userId)); await database.db.delete(rateLimit).where(eq(rateLimit.key, rateKey)); await database.close(); });
  it('commits operation and outbox together, then claims only once', async () => {
    const { operation } = await database.createBlog(userId, `writer-${userId.slice(0, 6)}`, 'writer');
    expect((await database.listPendingOutbox()).map((event) => event.operationId)).toContain(operation.id);
    const [first, second] = await Promise.all([database.claimOperation(operation.id), database.claimOperation(operation.id)]);
    expect([first, second].filter(Boolean)).toHaveLength(1); expect(await database.claimOperation(operation.id)).toBeNull();
    await database.db.update(operations).set({ attempts: MAX_OPERATION_ATTEMPTS, leaseExpiresAt: new Date('2026-08-28T00:00:00.000Z') }).where(eq(operations.id, operation.id));
    expect(await database.claimOperation(operation.id)).toBeNull(); expect((await database.getOperation(operation.id))?.status).toBe('failed');
  });
  it('marks outbox delivery without coupling the message to Cloud Tasks', async () => {
    const sent: unknown[] = []; const dispatcher = new OutboxDispatcher(database, { enqueue: (message) => { sent.push(message); return Promise.resolve(); } });
    expect(await dispatcher.dispatch()).toBeGreaterThan(0); expect(sent[0]).toMatchObject({ version: 1 });
    expect(await database.listPendingOutbox()).toHaveLength(0);
  });
  it('serializes concurrent email rate-limit consumption and resets after the window', async () => {
    const at = new Date('2026-08-29T00:00:00.000Z');
    expect((await Promise.all([database.consumeRateLimit(rateKey, 1, 60, at), database.consumeRateLimit(rateKey, 1, 60, at)])).sort()).toEqual([false, true]);
    expect(await database.consumeRateLimit(rateKey, 1, 60, new Date('2026-08-29T00:01:00.000Z'))).toBe(true);
  });
});

describe.skipIf(!url)('operation crash recovery', () => {
  const database = new AppDatabase(url ?? 'postgresql://unused');
  const users: string[] = [];
  const expired = new Date('2000-01-01T00:00:00Z');
  beforeAll(async () => { await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../src/drizzle', import.meta.url)) }); });
  afterEach(async () => { for (const id of users.splice(0)) await database.db.delete(user).where(eq(user.id, id)); });
  afterAll(async () => { await database.close(); });
  async function fixture() {
    const id = randomUUID(); users.push(id);
    await database.db.insert(user).values({ id, name: 'Recovery test', email: `${id}@example.com` });
    return database.createBlog(id, `recovery-${id.slice(0, 8)}`, 'writer');
  }
  function executor() {
    const config = loadWorkerConfig({ DATABASE_URL: url, OBJECT_STORE_ENDPOINT: 'http://unused', OBJECT_STORE_BUCKET: 'unused', OBJECT_STORE_ACCESS_KEY_ID: 'unused', OBJECT_STORE_SECRET_ACCESS_KEY: 'unused' });
    const artifacts = { uploadDirectory: () => Promise.resolve(), copyArtifact: () => Promise.resolve(), readObject: () => Promise.resolve(null), deleteArtifact: () => Promise.resolve() };
    return new AppOperationExecutor(database, artifacts, config);
  }
  it('reopens one crashed delivery and fences all writes from the previous attempt', async () => {
    const { operation, blog } = await fixture();
    const first = await database.claimOperation(operation.id); if (!first) throw new Error('Missing first claim');
    const [event] = await database.listPendingOutbox(); if (!event) throw new Error('Missing outbox');
    await database.markOutboxDispatched(event.id, event.message.traceId);
    await expect(executor().execute(operation.id)).rejects.toBeInstanceOf(RetryableOperationError);
    await database.db.update(operations).set({ leaseExpiresAt: expired }).where(eq(operations.id, operation.id));
    expect((await Promise.all([database.recoverExpiredOperations(), database.recoverExpiredOperations()])).reduce((a, b) => a + b)).toBe(1);
    const [recovered] = await database.listPendingOutbox();
    expect(recovered?.message.traceId).not.toBe(event.message.traceId);
    // A late ACK from the original dispatcher cannot hide the recovery delivery.
    await database.markOutboxDispatched(event.id, event.message.traceId);
    expect(await database.listPendingOutbox()).toHaveLength(1);
    const current = await database.claimOperation(operation.id); if (!current) throw new Error('Missing recovered claim');
    expect(current.attempts).toBe(2);
    await expect(database.failOperation(first, 'stale failure')).rejects.toBeInstanceOf(OperationLeaseLostError);
    await expect(database.updateOperationProgress(first, { kind: 'indeterminate' }, 'stale progress')).rejects.toBeInstanceOf(OperationLeaseLostError);
    const artifact = await database.createArtifact(blog.id, 'draft');
    const metadata = { title: 'Recovered draft', description: '', author: 'Writer', artifactId: artifact.id };
    await expect(database.completeSyncOperation(first, metadata, {})).rejects.toBeInstanceOf(OperationLeaseLostError);
    expect((await database.getBlog(blog.id))?.contentVersion).toBe(0);
    await database.completeSyncOperation(current, metadata, { message: 'done' });
    expect((await database.getBlog(blog.id))?.contentVersion).toBe(1);
    expect(await executor().execute(operation.id)).toEqual({ duplicate: true });
    // An ambiguous post-commit error cannot schedule the now-live artifact for deletion.
    await database.markArtifactCleanup(artifact.id);
    expect((await database.getArtifact(artifact.id))?.state).toBe('ready');
  });
  it('recovers stranded queued tasks and terminates after the execution retry budget', async () => {
    const { operation, blog } = await fixture();
    const [event] = await database.listPendingOutbox(); if (!event) throw new Error('Missing outbox');
    await database.markOutboxDispatched(event.id, event.message.traceId);
    await database.db.update(operations).set({ updatedAt: expired }).where(eq(operations.id, operation.id));
    expect(await database.recoverExpiredOperations()).toBe(1);
    expect((await database.listPendingOutbox())[0]?.message.traceId).not.toBe(event.message.traceId);
    await database.claimOperation(operation.id);
    await database.db.update(operations).set({ attempts: MAX_OPERATION_ATTEMPTS, leaseExpiresAt: expired }).where(eq(operations.id, operation.id));
    expect(await database.recoverExpiredOperations()).toBe(1);
    expect((await database.getOperation(operation.id))?.status).toBe('failed');
    expect((await database.getBlog(blog.id))?.state).toBe('failed');
    expect(await database.listPendingOutbox()).toHaveLength(0);
    expect(await database.claimOperation(operation.id)).toBeNull();
  });
  it.each(['generate_theme', 'publish'] as const)('fences %s completion before changing the active revision', async (type) => {
    const { operation, blog } = await fixture();
    const theme = await database.getActiveTheme(blog.id); if (!theme) throw new Error('Missing initial theme');
    await database.db.update(operations).set({ type, payload: { prompt: 'Test theme', contentVersion: 0, themeRevisionId: theme.id } }).where(eq(operations.id, operation.id));
    const first = await database.claimOperation(operation.id); if (!first) throw new Error('Missing first claim');
    await database.db.update(operations).set({ leaseExpiresAt: expired }).where(eq(operations.id, operation.id));
    const current = await database.claimOperation(operation.id); if (!current) throw new Error('Missing recovered claim');
    const artifact = await database.createArtifact(blog.id, 'release');
    const complete = (lease: typeof first) => type === 'generate_theme'
      ? database.completeThemeOperation(lease, DEFAULT_THEME, {})
      : database.completePublishOperation(lease, artifact.id, { site: { title: 'Test', description: '', author: 'Writer', language: 'en' }, posts: [] }, {});
    await expect(complete(first)).rejects.toBeInstanceOf(OperationLeaseLostError);
    expect((await database.getActiveTheme(blog.id))?.id).toBe(theme.id);
    expect(await database.getActiveRelease(blog.id)).toBeNull();
    await complete(current);
    await expect(complete(first)).rejects.toBeInstanceOf(OperationLeaseLostError);
    expect(type === 'generate_theme' ? (await database.listThemes(blog.id)).length : (await database.listReleases(blog.id)).length).toBe(type === 'generate_theme' ? 2 : 1);
  });
  it('runs the deployment smoke fixture through real DB execution and removes it afterwards', async () => {
    let operationId = '';
    const request: typeof fetch = async (_input, init) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 404 });
      if (typeof init?.body !== 'string') throw new Error('Missing task body');
      const { task } = JSON.parse(init.body) as { task: { httpRequest: { body: string } } };
      const body = Buffer.from(task.httpRequest.body, 'base64').toString();
      operationId = (JSON.parse(body) as { operationId: string }).operationId;
      expect(await database.listPendingOutbox()).toHaveLength(0);
      const response = await handleOperationTask(new Request('http://worker/tasks/operations', { method: 'POST', headers: { authorization: 'Bearer test-iam-boundary', 'x-cloudtasks-queuename': 'operations', 'content-type': 'application/json' }, body }), new CloudTasksRequestVerifier('operations'), executor());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ failed: true });
      return new Response('{}');
    };
    await smokeWorker({ candidateUrl: 'https://candidate---worker.run.app', audience: 'https://worker.run.app', queuePath: 'projects/test/locations/region/queues/operations', invokerEmail: 'tasks@test', accessToken: 'fake' }, database.pool, { fetch: request, polls: 1 });
    expect(operationId).not.toBe('');
    expect(await database.getOperation(operationId)).toBeNull();
  });
});
