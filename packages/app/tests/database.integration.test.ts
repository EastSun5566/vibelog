import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { DEFAULT_DESIGN_V2 } from '@vibelog/core';
import { AppDatabase, BlogAddressTakenError, MAX_OPERATION_ATTEMPTS, OperationLeaseLostError } from '../src/database.js';
import { AppOperationExecutor, OutboxDispatcher, RetryableOperationError } from '../src/jobs.js';
import { loadWorkerConfig } from '../src/config.js';
import { smokeWorker } from '../scripts/worker-smoke.js';
import { CloudTasksRequestVerifier } from '../src/adapters/cloud-tasks-request-verifier.js';
import { handleOperationTask } from '../src/adapters/cloud-tasks-transport.js';
import { aiDailyUsage, operationOutbox, operations, previewSessions, rateLimit, user } from '../src/schema.js';

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
  it('allows only one user to claim a blog address', async () => {
    const ids = [randomUUID(), randomUUID()];
    const username = `shared-${randomUUID().slice(0, 8)}`;
    try {
      await database.db.insert(user).values(ids.map((id) => ({ id, name: 'Writer', email: `${id}@example.com` })));
      const results = await Promise.allSettled(ids.map((id) => database.createBlog(id, username, 'writer')));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(BlogAddressTakenError);
    } finally {
      for (const id of ids) await database.db.delete(user).where(eq(user.id, id));
    }
  });
  it('removes a blog only after its artifacts are cleaned and frees the address', async () => {
    const ownerId = randomUUID(); const nextOwnerId = randomUUID(); const username = `delete-${ownerId.slice(0, 8)}`;
    try {
      await database.db.insert(user).values([
        { id: ownerId, name: 'Delete blog', email: `${ownerId}@example.com` },
        { id: nextOwnerId, name: 'Reuse address', email: `${nextOwnerId}@example.com` },
      ]);
      const { blog, operation } = await database.createBlog(ownerId, username, 'writer');
      await database.db.update(operations).set({ status: 'failed' }).where(eq(operations.id, operation.id));
      const artifact = await database.createArtifact(blog.id, 'draft');
      const plan = await database.beginBlogDeletion(ownerId);
      expect(plan?.artifacts.map((item) => item.id)).toEqual([artifact.id]);
      expect((await database.getBlog(blog.id))?.state).toBe('deleting');
      await expect(database.finishBlogDeletion(ownerId, blog.id)).rejects.toThrow('Blog artifacts remain');
      await database.noteBlogDeletionFailure(ownerId, blog.id);
      expect((await database.getBlog(blog.id))?.lastError).toContain('Retry');
      expect((await database.beginBlogDeletion(ownerId))?.artifacts.map((item) => item.id)).toEqual([artifact.id]);
      await database.deleteArtifactRecord(artifact.id);
      await database.finishBlogDeletion(ownerId, blog.id);
      expect(await database.getBlog(blog.id)).toBeNull();
      expect(await database.createBlog(nextOwnerId, username, 'writer')).toBeDefined();
    } finally {
      await database.db.delete(user).where(eq(user.id, ownerId));
      await database.db.delete(user).where(eq(user.id, nextOwnerId));
    }
  });
  it('deletes account-owned usage and rate-limit records with the user', async () => {
    const id = randomUUID(); const rateKeys = [`magic:minute:${id}`, `magic:hour:${id}`];
    await database.db.insert(user).values({ id, name: 'Delete account', email: `${id}@example.com` });
    try {
      const { blog, operation } = await database.createBlog(id, `account-${id.slice(0, 8)}`, 'writer');
      await database.db.update(operations).set({ status: 'failed' }).where(eq(operations.id, operation.id));
      await database.db.insert(aiDailyUsage).values({ usageDate: '2026-09-16', scope: 'user', subject: id, count: 1 });
      await database.db.insert(rateLimit).values(rateKeys.map((key) => ({ id: randomUUID(), key, count: 1, lastRequest: 1 })));
      const plan = await database.beginBlogDeletion(id);
      await database.finishAccountDeletion(id, plan?.blogId ?? null, rateKeys);
      expect(await database.getBlog(blog.id)).toBeNull();
      expect(await database.db.select().from(user).where(eq(user.id, id))).toHaveLength(0);
      expect(await database.db.select().from(aiDailyUsage).where(eq(aiDailyUsage.subject, id))).toHaveLength(0);
      expect(await database.db.select().from(rateLimit).where(eq(rateLimit.key, rateKeys[0] ?? ''))).toHaveLength(0);
    } finally {
      await database.db.delete(user).where(eq(user.id, id));
    }
  });
  it('prunes expired transient data without touching active or recent records', async () => {
    const id = randomUUID(); const at = new Date('2000-03-01T12:00:00.000Z');
    await database.db.insert(user).values({ id, name: 'Maintenance', email: `${id}@example.com` });
    try {
      const { blog, operation } = await database.createBlog(id, `maintenance-${id.slice(0, 8)}`, 'writer');
      const recentOperationId = randomUUID(); const activeOperationId = randomUUID();
      await database.db.update(operations).set({ status: 'failed', updatedAt: new Date('2000-01-01T00:00:00.000Z') }).where(eq(operations.id, operation.id));
      await database.db.insert(operations).values([
        { id: recentOperationId, userId: id, blogId: blog.id, type: 'sync', status: 'succeeded', payload: {}, updatedAt: new Date('2000-02-29T00:00:00.000Z') },
        { id: activeOperationId, userId: id, blogId: blog.id, type: 'sync', status: 'queued', payload: {}, updatedAt: new Date('2000-01-01T00:00:00.000Z') },
      ]);
      await database.db.insert(operationOutbox).values([
        { id: randomUUID(), operationId: recentOperationId, payload: {}, dispatchedAt: at },
        { id: randomUUID(), operationId: activeOperationId, payload: {} },
      ]);
      await database.db.insert(previewSessions).values([
        { tokenHash: `expired-${id}`, userId: id, blogId: blog.id, expiresAt: new Date('2000-03-01T11:59:59.000Z') },
        { tokenHash: `current-${id}`, userId: id, blogId: blog.id, expiresAt: at },
        { tokenHash: `future-${id}`, userId: id, blogId: blog.id, expiresAt: new Date('2000-03-01T12:00:01.000Z') },
      ]);
      await database.db.insert(aiDailyUsage).values([
        { usageDate: '2000-01-30', scope: 'user', subject: id, count: 1 },
        { usageDate: '2000-01-31', scope: 'global', subject: id, count: 1 },
      ]);
      await database.db.insert(rateLimit).values([
        { id: randomUUID(), key: `old-${id}`, count: 1, lastRequest: Math.floor(at.getTime() / 1000) - 86_401 },
        { id: randomUUID(), key: `current-${id}`, count: 1, lastRequest: Math.floor(at.getTime() / 1000) - 86_400 },
      ]);

      expect(await database.pruneTransientData(at)).toEqual({ previewSessions: 2, operations: 1, aiUsage: 1, rateLimits: 1 });
      expect(await database.getOperation(operation.id)).toBeNull();
      expect(await database.getOperation(recentOperationId)).not.toBeNull();
      expect(await database.getOperation(activeOperationId)).not.toBeNull();
      expect(await database.db.select().from(operationOutbox).where(eq(operationOutbox.operationId, operation.id))).toHaveLength(0);
      expect(await database.db.select().from(previewSessions).where(eq(previewSessions.blogId, blog.id))).toHaveLength(1);
      expect(await database.db.select().from(aiDailyUsage).where(eq(aiDailyUsage.subject, id))).toHaveLength(1);
      expect(await database.db.select().from(rateLimit).where(eq(rateLimit.key, `current-${id}`))).toHaveLength(1);
    } finally {
      await database.db.delete(user).where(eq(user.id, id));
      await database.db.delete(rateLimit).where(eq(rateLimit.key, `old-${id}`));
      await database.db.delete(rateLimit).where(eq(rateLimit.key, `current-${id}`));
    }
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
    const artifacts = { uploadDirectory: () => Promise.resolve(), materializeArtifact: () => Promise.resolve(), copyArtifact: () => Promise.resolve(), putObject: () => Promise.resolve(), listObjects: () => Promise.resolve([]), readObject: () => Promise.resolve(null), deleteArtifact: () => Promise.resolve() };
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
    const sourceArtifact = await database.createArtifact(blog.id, 'source');
    const draftArtifact = await database.createArtifact(blog.id, 'draft');
    const design = await database.getActiveDesign(blog.id); if (!design) throw new Error('Missing initial design');
    const metadata = {
      title: 'Recovered draft', description: '', author: 'Writer',
      sourceArtifactId: sourceArtifact.id, draftArtifactId: draftArtifact.id, designRevisionId: design.id,
      contentProfile: { postCount: 0, tagCount: 0, averageLength: 'short' as const, codeUsage: 'none' as const, imageUsage: 'none' as const, mathUsage: 'none' as const },
    };
    await expect(database.completeSyncOperation(first, metadata, {})).rejects.toBeInstanceOf(OperationLeaseLostError);
    expect((await database.getBlog(blog.id))?.contentVersion).toBe(0);
    await database.completeSyncOperation(current, metadata, { message: 'done' });
    expect((await database.getBlog(blog.id))?.contentVersion).toBe(1);
    expect(await executor().execute(operation.id)).toEqual({ duplicate: true });
    // An ambiguous post-commit error cannot schedule the now-live artifact for deletion.
    await database.markArtifactCleanup(draftArtifact.id);
    expect((await database.getArtifact(draftArtifact.id))?.state).toBe('ready');
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
  it.each(['apply_design', 'publish'] as const)('fences %s completion before changing the active draft', async (type) => {
    const { operation: syncOperation, blog } = await fixture();
    const syncLease = await database.claimOperation(syncOperation.id); if (!syncLease) throw new Error('Missing sync claim');
    const initialDesign = await database.getActiveDesign(blog.id); if (!initialDesign) throw new Error('Missing initial design');
    const source = await database.createArtifact(blog.id, 'source');
    const initialDraft = await database.createArtifact(blog.id, 'draft');
    await database.completeSyncOperation(syncLease, {
      title: 'Writer', description: '', author: 'Writer', sourceArtifactId: source.id, draftArtifactId: initialDraft.id,
      designRevisionId: initialDesign.id,
      contentProfile: { postCount: 0, tagCount: 0, averageLength: 'short', codeUsage: 'none', imageUsage: 'none', mathUsage: 'none' },
    }, {});
    let operation;
    if (type === 'apply_design') operation = await database.createApplyDesignOperation(blog.userId, blog.id, DEFAULT_DESIGN_V2);
    else {
      const tokenHash = randomUUID();
      await database.createPreviewSession(tokenHash, blog.userId, blog.id, '2099-01-01T00:00:00.000Z', DEFAULT_DESIGN_V2);
      operation = await database.createPublishOperation(blog.userId, blog.id, tokenHash);
    }
    const first = await database.claimOperation(operation.id); if (!first) throw new Error('Missing first claim');
    await database.db.update(operations).set({ leaseExpiresAt: expired }).where(eq(operations.id, operation.id));
    const current = await database.claimOperation(operation.id); if (!current) throw new Error('Missing recovered claim');
    const artifact = await database.createArtifact(blog.id, type === 'apply_design' ? 'draft' : 'release');
    const complete = (lease: typeof first) => type === 'apply_design'
      ? database.completeDesignOperation(lease, DEFAULT_DESIGN_V2, artifact.id, {})
      : database.completePublishOperation(lease, artifact.id, { site: { title: 'Test', description: '', author: 'Writer', language: 'en' }, posts: [] }, {});
    await expect(complete(first)).rejects.toBeInstanceOf(OperationLeaseLostError);
    expect((await database.getActiveDesign(blog.id))?.id).toBe(initialDesign.id);
    expect(await database.getActiveRelease(blog.id)).toBeNull();
    await complete(current);
    await expect(complete(first)).rejects.toBeInstanceOf(OperationLeaseLostError);
    expect(type === 'apply_design' ? (await database.listDesignRevisions(blog.id)).length : (await database.listReleases(blog.id)).length).toBe(type === 'apply_design' ? 2 : 1);
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
    await smokeWorker({ workerUrl: 'https://worker.run.app', queuePath: 'projects/test/locations/region/queues/operations', invokerEmail: 'tasks@test', accessToken: 'fake' }, database.pool, { fetch: request, polls: 1 });
    expect(operationId).not.toBe('');
    expect(await database.getOperation(operationId)).toBeNull();
  });
});
