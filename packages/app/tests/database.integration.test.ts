import { createHmac, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AppVariables } from '../src/auth.js';
import { edgeIdentity } from '../src/security/edge-identity.js';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_DESIGN_V2 } from '@vibelog/core';
import { AppDatabase, BlogAddressTakenError, MAX_OPERATION_ATTEMPTS, OperationLeaseLostError } from '../src/database.js';
import { AppOperationExecutor, OutboxDispatcher, RetryableOperationError } from '../src/jobs.js';
import { loadWorkerConfig } from '../src/config.js';
import { smokeWorker } from '../scripts/worker-smoke.js';
import { CloudTasksRequestVerifier } from '../src/adapters/cloud-tasks-request-verifier.js';
import { AgentRepository, operationResult } from '../src/agent/repository.js';
import { stateVersion } from '../src/agent/contracts.js';
import { agentRoutes } from '../src/agent/routes.js';
import { jsonError, requestContext } from '../src/http.js';
import { agentDailyUsage, agentGrants, agentPairings, agentRequests } from '../src/schema.js';
import { handleOperationTask } from '../src/adapters/cloud-tasks-transport.js';
import { aiDailyUsage, blogs, operationOutbox, operations, previewSessions, rateLimit, user } from '../src/schema.js';

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

      expect(await database.pruneTransientData(at)).toMatchObject({ previewSessions: 2, operations: 1, aiUsage: 1, rateLimits: 1 });
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
  it('snapshots the saved AI base and rejects stale design completion', async () => {
    const { operation: syncOperation, blog } = await fixture();
    const syncLease = await database.claimOperation(syncOperation.id); if (!syncLease) throw new Error('Missing sync claim');
    const initial = await database.getActiveDesign(blog.id); if (!initial) throw new Error('Missing initial design');
    const source = await database.createArtifact(blog.id, 'source');
    const draft = await database.createArtifact(blog.id, 'draft');
    await database.completeSyncOperation(syncLease, {
      title: 'Writer', description: '', author: 'Writer', sourceArtifactId: source.id, draftArtifactId: draft.id,
      designRevisionId: initial.id,
      contentProfile: { postCount: 0, tagCount: 0, averageLength: 'short', codeUsage: 'none', imageUsage: 'none', mathUsage: 'none' },
    }, {});
    const limits = { userDailyLimit: 1000, globalDailyLimit: 100_000, at: new Date('2026-09-26T00:00:00Z') };
    await expect(database.createDesignOperation(blog.userId, blog.id, 'Make it warmer', randomUUID(), limits)).rejects.toThrow('Active design changed before generation');
    const ai = await database.createDesignOperation(blog.userId, blog.id, 'Make it warmer', initial.id, limits);
    expect(ai.payload).toMatchObject({ baseRevisionId: initial.id, baseDesign: initial.config });
    const aiLease = await database.claimOperation(ai.id); if (!aiLease) throw new Error('Missing AI claim');
    await database.db.update(blogs).set({ contentVersion: sql`${blogs.contentVersion} + 1` }).where(eq(blogs.id, blog.id));
    const staleArtifact = await database.createArtifact(blog.id, 'draft');
    await expect(database.completeDesignOperation(aiLease, DEFAULT_DESIGN_V2, staleArtifact.id, {})).rejects.toThrow('Draft changed before design completion');
    expect((await database.getActiveDesign(blog.id))?.id).toBe(initial.id);
    expect((await database.getBlog(blog.id))?.draftArtifactId).toBe(draft.id);
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

describe.skipIf(!url)('Agent grants and atomic draft admission', () => {
  const database = new AppDatabase(url ?? 'postgresql://unused');
  const repository = new AgentRepository(database);
  const ids: string[] = [];
  beforeAll(async () => { await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../src/drizzle', import.meta.url)) }); });
  afterAll(async () => {
    for (const id of ids) { await database.db.delete(agentDailyUsage).where(eq(agentDailyUsage.subject, id)); await database.db.delete(user).where(eq(user.id, id)); }
    await database.close();
  });
  async function owner() { const id = randomUUID(); ids.push(id); await database.db.insert(user).values({ id, name: 'Agent owner', email: `${id}@example.com` }); return id; }
  async function grant(id: string) {
    const pairing = await repository.createPairing(); await repository.approve(id, pairing.userCode, true);
    const result = await repository.redeem(pairing.deviceCode); if (result.status !== 'approved') throw new Error('Expected approval'); return { pairing, ...result };
  }
  it('limits an anonymous client before shared pairing/poll budgets and isolates another client', async () => {
    const secret = 'test-edge-secret'; const nonce = randomUUID();
    const client = createHmac('sha256', secret).update(`${nonce}:attacker`).digest('base64url');
    const legitimate = createHmac('sha256', secret).update(`${nonce}:legitimate`).digest('base64url');
    const app = new Hono<{ Variables: AppVariables }>().use('*', requestContext()).use('*', edgeIdentity(secret));
    app.route('/api/agent/v1', agentRoutes(database, { dispatch: () => Promise.resolve(0) }, 'https://vibelog.org', { edgeSharedSecret: secret, betterAuthSecret: 'test' }));
    app.onError((error, c) => jsonError(c, error));
    const request = (path: string, key: string, body = '{}') => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', secret).update(`${timestamp}\nvibelog.org\n/api/agent/v1${path}\n${key}`).digest('base64url');
      return app.request(`/api/agent/v1${path}`, { method: 'POST', body, headers: {
        'Content-Type': 'application/json', 'x-vibelog-host': 'vibelog.org', 'x-vibelog-timestamp': timestamp,
        'x-vibelog-client-key': key, 'x-vibelog-signature': signature,
      } });
    };
    const usage = async (key: string) => (await database.db.select().from(rateLimit).where(eq(rateLimit.key, `agent:${key}`)))[0]?.count ?? 0;
    const pairingBefore = await usage('pairing:global');
    for (let i = 0; i < 10; i++) expect((await request('/pairings', client)).status).toBe(201);
    expect((await request('/pairings', client)).status).toBe(429);
    expect(await usage('pairing:global')).toBe(pairingBefore + 10);
    expect((await request('/pairings', legitimate)).status).toBe(201);
    const pollBefore = await usage('poll:global');
    expect((await request('/pairings/token', client, '{}')).status).toBe(400);
    for (let i = 0; i < 59; i++) expect((await request('/pairings/token', client, JSON.stringify({ deviceCode: 'a'.repeat(43) }))).status).toBe(410);
    const blocked = await request('/pairings/token', client, '{}');
    expect(blocked.status).toBe(429); expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(await usage('poll:global')).toBe(pollBefore);
    const pairing = await repository.createPairing(); const id = await owner(); await repository.approve(id, pairing.userCode, true);
    expect((await request('/pairings/token', legitimate, JSON.stringify({ deviceCode: pairing.deviceCode }))).status).toBe(200);
    expect(await usage('poll:global')).toBe(pollBefore + 1);
    // Calling Cloud Run directly cannot rotate a spoofed IP header to bypass the client budget.
    expect((await app.request('/api/agent/v1/pairings', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.30', 'x-vibelog-client-key': legitimate } })).status).toBe(401);
  });
  it('self-host client budgets use the socket peer rather than spoofable proxy headers', async () => {
    const router = agentRoutes(database, { dispatch: () => Promise.resolve(0) }, 'http://localhost', { betterAuthSecret: randomUUID() });
    const env = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
    for (let i = 0; i < 10; i++) expect((await router.request('/pairings', { method: 'POST', headers: { 'x-forwarded-for': `192.0.2.${String(i)}` } }, env)).status).toBe(201);
    expect((await router.request('/pairings', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.100', 'x-vibelog-client-key': 'b'.repeat(43) } }, env)).status).toBe(429);
    expect((await router.request('/pairings', { method: 'POST' }, { incoming: { socket: { remoteAddress: '127.0.0.2' } } })).status).toBe(201);
  });
  it('requires explicit approval and redeems a hash-only grant exactly once', async () => {
    const id = await owner(); const pairing = await repository.createPairing();
    await expect(repository.redeem(pairing.deviceCode)).rejects.toMatchObject({ code: 'slow_down' });
    await database.db.update(agentPairings).set({ updatedAt: new Date(Date.now() - 6000) }).where(eq(agentPairings.userCode, pairing.userCode));
    expect(await repository.redeem(pairing.deviceCode)).toEqual({ status: 'pending' });
    await repository.approve(id, pairing.userCode, true);
    const result = await repository.redeem(pairing.deviceCode); expect(result.status).toBe('approved');
    if (result.status !== 'approved') throw new Error('Expected approval');
    const saved = await repository.grant(result.token); expect(saved.userId).toBe(id); expect(saved.tokenHash).not.toBe(result.token);
    expect(new Date(result.expiresAt).getTime() - Date.now()).toBeGreaterThan(43190_000);
    await expect(repository.redeem(pairing.deviceCode)).rejects.toMatchObject({ code: 'pairing_denied' });
    await expect(repository.approve(id, pairing.userCode, true)).rejects.toMatchObject({ code: 'pairing_unavailable' });
  });
  it('denial, expiry and owner-only revocation reject authorization', async () => {
    const id = await owner(); const other = await owner(); const pairing = await repository.createPairing();
    await repository.approve(id, pairing.userCode, false); await expect(repository.redeem(pairing.deviceCode)).rejects.toMatchObject({ code: 'pairing_denied' });
    const approved = await grant(id); const saved = await repository.grant(approved.token);
    await repository.revoke(other, saved.id); expect((await repository.grant(approved.token)).id).toBe(saved.id);
    await repository.revoke(id, saved.id); await expect(repository.grant(approved.token)).rejects.toMatchObject({ code: 'agent_unauthorized' });
    const expired = await grant(id); await database.db.update(agentGrants).set({ expiresAt: new Date(0) }).where(eq(agentGrants.userId, id));
    await expect(repository.grant(expired.token)).rejects.toMatchObject({ code: 'agent_unauthorized' });
    await database.db.update(agentPairings).set({ expiresAt: new Date(0) }).where(eq(agentPairings.userCode, expired.pairing.userCode));
    await expect(repository.redeem(expired.pairing.deviceCode)).rejects.toMatchObject({ code: 'pairing_expired' });
  });
  it('shows approval outcomes only to their owner and distinguishes request expiry from consumption', async () => {
    const id = await owner(); const other = await owner(); const pairing = await repository.createPairing();
    expect(await repository.authorization(other, pairing.userCode)).toMatchObject({ status: 'pending' });
    await repository.approve(id, pairing.userCode, true);
    expect(await repository.authorization(id, pairing.userCode)).toMatchObject({ status: 'approved' });
    expect(await repository.authorization(other, pairing.userCode)).toBeNull();
    await repository.redeem(pairing.deviceCode);
    await database.db.update(agentPairings).set({ expiresAt: new Date(0) }).where(eq(agentPairings.userCode, pairing.userCode));
    expect(await repository.authorization(id, pairing.userCode)).toMatchObject({ status: 'consumed' });
    expect(await repository.authorization(other, pairing.userCode)).toBeNull();
    const denied = await repository.createPairing(); await repository.approve(id, denied.userCode, false);
    expect(await repository.authorization(id, denied.userCode)).toMatchObject({ status: 'denied' });
    expect(await repository.authorization(other, denied.userCode)).toBeNull();
    const expired = await repository.createPairing();
    await database.db.update(agentPairings).set({ expiresAt: new Date(0) }).where(eq(agentPairings.userCode, expired.userCode));
    expect(await repository.authorization(id, expired.userCode)).toMatchObject({ status: 'expired' });
    const unredeemed = await repository.createPairing(); await repository.approve(id, unredeemed.userCode, true);
    await database.db.update(agentPairings).set({ expiresAt: new Date(0) }).where(eq(agentPairings.userCode, unredeemed.userCode));
    expect(await repository.authorization(id, unredeemed.userCode)).toMatchObject({ status: 'expired' });
  });
  it('distinguishes initial-sync recovery, retained drafts and deleting blogs without rebuilding a ready draft', async () => {
    const id = await owner(); const approved = await grant(id);
    const router = agentRoutes(database, { dispatch: () => Promise.resolve(0) }, 'https://vibelog.org', { betterAuthSecret: 'test-secret' });
    const headers = { Authorization: `Bearer ${approved.token}` };
    const context = async () => (await router.request('/context', { headers })).json() as Promise<unknown>;
    const session = await router.request('/session', { headers });
    expect(session.headers.get('cache-control')).toBe('no-store');
    expect(await session.json()).toEqual({ permission: 'draft:read-write', expiresAt: approved.expiresAt });
    expect(await context()).toMatchObject({ blog: null, sourceReady: false, draftReady: false, nextActions: [{ action: 'connect' }] });
    const input = { username: `resume-${id.slice(0, 8)}`, hackmdUsername: 'alice', language: 'en' };
    const { blog, operation } = await database.createBlog(id, input.username, input.hackmdUsername);
    expect(await context()).toMatchObject({ blog: { state: 'syncing' }, sourceReady: false, draftReady: false, operationId: operation.id, nextActions: [{ action: 'wait', operationId: operation.id }] });
    await database.db.update(operations).set({ status: 'running' }).where(eq(operations.id, operation.id));
    expect(await context()).toMatchObject({ nextActions: [{ action: 'wait', operationId: operation.id }] });
    await database.db.update(operations).set({ status: 'failed' }).where(eq(operations.id, operation.id));
    await database.db.update(blogs).set({ state: 'failed' }).where(eq(blogs.id, blog.id));
    expect(await context()).toMatchObject({ blog: { state: 'failed' }, sourceReady: false, draftReady: false, operationId: null, nextActions: [{ action: 'connect', reason: 'initial_sync_recovery' }] });
    const connect = (body = input) => router.request('/connect', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body) });
    const retry = await connect(); expect(retry.status).toBe(202);
    const accepted = await retry.json() as { operationId: string };
    expect(await context()).toMatchObject({ operationId: accepted.operationId });
    const lease = await database.claimOperation(accepted.operationId); if (!lease) throw new Error('Missing sync claim');
    const initial = await database.getActiveDesign(blog.id); if (!initial) throw new Error('Missing initial design');
    const source = await database.createArtifact(blog.id, 'source'); const draft = await database.createArtifact(blog.id, 'draft');
    await database.completeSyncOperation(lease, {
      title: 'Writer', description: '', author: 'Writer', sourceArtifactId: source.id, draftArtifactId: draft.id, designRevisionId: initial.id,
      contentProfile: { postCount: 0, tagCount: 0, averageLength: 'short', codeUsage: 'none', imageUsage: 'none', mathUsage: 'none' },
    }, {});
    // A later failure must not make the existing draft look like a fresh account.
    await database.db.update(blogs).set({ state: 'failed' }).where(eq(blogs.id, blog.id));
    const readyContext = await context();
    expect(readyContext).toMatchObject({ blog: { state: 'failed' }, sourceReady: true, draftReady: true, operationId: null, nextActions: ['design', 'identity', 'selection', 'sync', 'open_editor'].map((action) => ({ action })) });
    expect(JSON.stringify(readyContext)).not.toContain(source.id); expect(JSON.stringify(readyContext)).not.toContain(draft.id);
    expect(await (await connect()).json()).toEqual({ status: 'unchanged' });
    expect((await connect({ ...input, hackmdUsername: 'other-profile' })).status).toBe(409);
    expect(await database.getActiveOperation(blog.id, id)).toBeNull(); expect(await database.listDesignRevisions(blog.id)).toHaveLength(1);
    expect((await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id)))[0]?.count).toBe(1);
    for (const partial of [{ sourceArtifactId: source.id, draftArtifactId: null }, { sourceArtifactId: null, draftArtifactId: draft.id }]) {
      await database.db.update(blogs).set(partial).where(eq(blogs.id, blog.id));
      expect(await context()).toMatchObject({ nextActions: [{ action: 'open_editor', reason: 'draft_recovery_required' }] });
    }
    await database.db.update(blogs).set({ sourceArtifactId: source.id, draftArtifactId: draft.id }).where(eq(blogs.id, blog.id));
    await database.beginBlogDeletion(id);
    expect(await context()).toMatchObject({ blog: { state: 'deleting' }, sourceReady: true, draftReady: true, nextActions: [{ action: 'open_editor', reason: 'deletion_in_progress' }] });
    expect((await connect()).status).toBe(409);
  });
  it('serializes duplicate bootstrap and rejects changed payloads without charging twice', async () => {
    const id = await owner(); const key = randomUUID(); const body = { username: `agent-${id.slice(0, 8)}` };
    const work = async (db: AppDatabase) => operationResult((await db.createBlog(id, body.username, 'alice')).operation);
    const [first, second] = await Promise.all([repository.mutation(id, key, 'connect', body, work), repository.mutation(id, key, 'connect', body, work)]);
    expect(first).toEqual(second); expect(await database.db.select().from(agentRequests).where(eq(agentRequests.userId, id))).toHaveLength(1);
    expect((await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id)))[0]?.count).toBe(1);
    await expect(repository.mutation(id, key, 'connect', { username: 'changed' }, work)).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
  it('serializes first-time browser bootstrap behind an agent that already read no blog', async () => {
    const id = await owner(); const username = `agent-first-${id.slice(0, 8)}`;
    let markLocked: ((pid: number) => void) | undefined; let releaseAgent: (() => void) | undefined;
    const locked = new Promise<number>((resolve) => { markLocked = resolve; });
    const continueAgent = new Promise<void>((resolve) => { releaseAgent = resolve; });
    const agent = repository.mutation(id, randomUUID(), 'connect', { username }, async (db, blog) => {
      expect(blog).toBeNull();
      const backend = await db.db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      markLocked?.(backend.rows[0].pid); await continueAgent;
      return operationResult((await db.createBlog(id, username, 'alice')).operation);
    }).then((result) => result, (error: unknown) => error);
    const pid = await locked;
    const browser = database.createBlog(id, `browser-first-${id.slice(0, 8)}`, 'alice').then((result) => result, (error: unknown) => error);
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await database.pool.query<{ waiting: boolean }>('select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as waiting', [pid])).rows[0].waiting;
        if (!waiting) await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
      }
    } finally { releaseAgent?.(); }
    const [agentResult, browserResult] = await Promise.all([agent, browser]);
    expect(waiting).toBe(true);
    expect(agentResult).toMatchObject({ status: 'accepted' });
    expect(browserResult).toMatchObject({ name: 'BlogAlreadyExistsError' });
    expect((await database.getBlogForUser(id))?.username).toBe(username);
    expect(await database.db.select().from(agentRequests).where(eq(agentRequests.userId, id))).toHaveLength(1);
    expect((await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id)))[0]?.count).toBe(1);
  });
  it('returns a source conflict instead of 500 when first-time browser bootstrap wins', async () => {
    const id = await owner(); const approved = await grant(id); const username = `browser-wins-${id.slice(0, 8)}`;
    let markLocked: ((pid: number) => void) | undefined; let releaseBrowser: (() => void) | undefined;
    const locked = new Promise<number>((resolve) => { markLocked = resolve; });
    const continueBrowser = new Promise<void>((resolve) => { releaseBrowser = resolve; });
    const browser = database.transaction(async (db) => {
      const result = await db.createBlog(id, username, 'alice');
      const backend = await db.db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      markLocked?.(backend.rows[0].pid); await continueBrowser; return result;
    });
    const pid = await locked;
    const router = agentRoutes(database, { dispatch: () => Promise.resolve(0) }, 'https://vibelog.org', { betterAuthSecret: 'test-secret' });
    const response = router.request('/connect', {
      method: 'POST', headers: { Authorization: `Bearer ${approved.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ username: `agent-loses-${id.slice(0, 8)}`, hackmdUsername: 'alice', language: 'en' }),
    });
    let waiting = false;
    try {
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await database.pool.query<{ waiting: boolean }>('select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as waiting', [pid])).rows[0].waiting;
        if (!waiting) await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
      }
    } finally { releaseBrowser?.(); }
    const [created, result] = await Promise.all([browser, response]);
    expect(waiting).toBe(true); expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: { code: 'source_locked' } });
    expect((await database.getBlogForUser(id))?.id).toBe(created.blog.id);
    expect(await database.db.select().from(agentRequests).where(eq(agentRequests.userId, id))).toHaveLength(0);
    expect(await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id))).toHaveLength(0);
  });
  it('cooperates with concurrent browser admission without blocking its user foreign key', async () => {
    const id = await owner(); const { blog, operation } = await database.createBlog(id, `concurrent-${id.slice(0, 8)}`, 'alice');
    await database.db.update(operations).set({ status: 'failed' }).where(eq(operations.id, operation.id));
    let markLocked: ((pid: number) => void) | undefined; let releaseBrowser: (() => void) | undefined;
    const locked = new Promise<number>((resolve) => { markLocked = resolve; });
    const continueBrowser = new Promise<void>((resolve) => { releaseBrowser = resolve; });
    const browserResult = database.transaction(async (db) => {
      await db.db.execute(sql`set local lock_timeout = '2s'`);
      await db.db.select().from(blogs).where(eq(blogs.id, blog.id)).for('update');
      const backend = await db.db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      markLocked?.(backend.rows[0].pid); await continueBrowser;
      await db.createSyncOperation(id, blog.id, { intent: 'content' });
    }).then(() => null, (error: unknown) => error);
    const pid = await locked;
    const agentResult = repository.mutation(id, randomUUID(), 'design', { stateVersion: stateVersion(blog) }, () => Promise.resolve({ status: 'unchanged' }))
      .then((result) => result, (error: unknown) => error);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await database.pool.query<{ waiting: boolean }>('select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as waiting', [pid])).rows[0].waiting;
        if (!waiting) await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
      }
      expect(waiting).toBe(true);
    } finally { releaseBrowser?.(); }
    expect(await browserResult).toBeNull();
    expect(await agentResult).toMatchObject({ code: 'operation_in_progress' });
    expect(await database.db.select().from(agentRequests).where(eq(agentRequests.userId, id))).toHaveLength(0);
  });
  it('rolls back operation, outbox and request record when quota is exhausted', async () => {
    const id = await owner(); const date = new Date().toISOString().slice(0, 10);
    await database.db.insert(agentDailyUsage).values({ usageDate: date, subject: id, count: 10 });
    const key = randomUUID();
    await expect(repository.mutation(id, key, 'connect', {}, async (db) => operationResult((await db.createBlog(id, `quota-${id.slice(0, 8)}`, 'alice')).operation))).rejects.toMatchObject({ code: 'agent_build_quota_exceeded' });
    expect(await database.getBlogForUser(id)).toBeNull(); expect(await database.db.select().from(agentRequests).where(eq(agentRequests.userId, id))).toHaveLength(0);
    expect((await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id)))[0]?.count).toBe(10);
  });
  it('rejects stale state and retains no-op request without charging build quota', async () => {
    const id = await owner(); const { blog, operation } = await database.createBlog(id, `state-${id.slice(0, 8)}`, 'alice');
    await database.db.update(operations).set({ status: 'failed' }).where(eq(operations.id, operation.id));
    const input = { stateVersion: stateVersion(blog) };
    expect(await repository.mutation(id, randomUUID(), 'design', input, () => Promise.resolve({ status: 'unchanged' }))).toEqual({ status: 'unchanged' });
    expect(await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id))).toHaveLength(0);
    await database.db.update(blogs).set({ contentVersion: blog.contentVersion + 1 }).where(eq(blogs.id, blog.id));
    await expect(repository.mutation(id, randomUUID(), 'design', input, () => Promise.resolve({ status: 'unchanged' }))).rejects.toMatchObject({ code: 'state_changed' });
  });
  it('rolls back admission when the shared global build quota is exhausted', async () => {
    const id = await owner(); const date = new Date().toISOString().slice(0, 10);
    const condition = and(eq(agentDailyUsage.usageDate, date), eq(agentDailyUsage.subject, '*'));
    const [previous] = await database.db.select().from(agentDailyUsage).where(condition);
    await database.db.insert(agentDailyUsage).values({ usageDate: date, subject: '*', count: 50 })
      .onConflictDoUpdate({ target: [agentDailyUsage.usageDate, agentDailyUsage.subject], set: { count: 50 } });
    try {
      await expect(repository.mutation(id, randomUUID(), 'connect', {}, async (db) => operationResult((await db.createBlog(id, `global-${id.slice(0, 8)}`, 'alice')).operation))).rejects.toMatchObject({ code: 'agent_build_quota_exceeded' });
      expect(await database.getBlogForUser(id)).toBeNull();
      expect(await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id))).toHaveLength(0);
      expect(await database.db.select().from(agentRequests).where(eq(agentRequests.userId, id))).toHaveLength(0);
      expect((await database.db.select().from(agentDailyUsage).where(condition))[0]?.count).toBe(50);
    } finally {
      if (previous) await database.db.update(agentDailyUsage).set({ count: previous.count }).where(condition);
      else await database.db.delete(agentDailyUsage).where(condition);
    }
  });
  it('treats an identical design submission as an unchanged draft', async () => {
    const id = await owner(); const approved = await grant(id);
    const { blog, operation } = await database.createBlog(id, `noop-${id.slice(0, 8)}`, 'alice');
    const lease = await database.claimOperation(operation.id); if (!lease) throw new Error('Missing sync claim');
    const initial = await database.getActiveDesign(blog.id); if (!initial) throw new Error('Missing initial design');
    const source = await database.createArtifact(blog.id, 'source'); const draft = await database.createArtifact(blog.id, 'draft');
    await database.completeSyncOperation(lease, {
      title: 'Writer', description: '', author: 'Writer', sourceArtifactId: source.id, draftArtifactId: draft.id,
      designRevisionId: initial.id,
      contentProfile: { postCount: 0, tagCount: 0, averageLength: 'short', codeUsage: 'none', imageUsage: 'none', mathUsage: 'none' },
    }, {});
    const current = await database.getBlog(blog.id); if (!current) throw new Error('Missing blog');
    const router = agentRoutes(database, { dispatch: () => Promise.reject(new Error('No dispatch expected')) }, 'https://vibelog.org', { betterAuthSecret: 'test-secret' });
    const response = await router.request('/design', {
      method: 'POST', headers: { Authorization: `Bearer ${approved.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ stateVersion: stateVersion(current), design: initial.config }),
    });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: 'unchanged' });
    expect(await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id))).toHaveLength(0);
    expect(await database.getActiveOperation(blog.id, id)).toBeNull();
    expect(await database.listDesignRevisions(blog.id)).toHaveLength(1);
    expect((await database.getBlog(blog.id))?.draftArtifactId).toBe(draft.id);
  });
  it('agent router returns JSON for auth/ownership errors and cannot publish or call hosted AI', async () => {
    const id = await owner(); const other = await owner(); const approved = await grant(id);
    const { operation } = await database.createBlog(other, `other-${other.slice(0, 8)}`, 'alice');
    const router = agentRoutes(database, { dispatch: () => Promise.resolve(0) }, 'https://vibelog.org', { betterAuthSecret: 'test-secret' });
    router.use('*', requestContext()); router.onError((error, c) => jsonError(c, error));
    const headers = { Authorization: `Bearer ${approved.token}` };
    expect((await router.request('/context')).status).toBe(401);
    const foreign = await router.request(`/operations/${operation.id}`, { headers }); expect(foreign.status).toBe(404); expect(await foreign.json()).toHaveProperty('error.code', 'operation_not_found');
    for (const path of ['/publish', '/generate', '/export', '/delete', '/releases/restore']) expect((await router.request(path, { method: 'POST', headers })).status).toBe(404);
    const context = await router.request('/context', { headers }); expect(context.headers.get('cache-control')).toBe('no-store'); expect(await context.json()).toMatchObject({ blog: null, editorUrl: 'https://vibelog.org/editor' });
    await repository.revoke(id, (await repository.grant(approved.token)).id); expect((await router.request('/context', { headers })).status).toBe(401);
  });
  it('daily cleanup expires grants and old requests but retains active operation recovery', async () => {
    const id = await owner(); const expired = await grant(id); const live = await grant(id);
    const at = new Date(); const old = new Date('2000-01-01T00:00:00Z');
    await database.db.update(agentGrants).set({ expiresAt: at }).where(eq(agentGrants.id, (await repository.grant(expired.token)).id));
    await database.db.update(agentPairings).set({ expiresAt: at }).where(eq(agentPairings.userCode, expired.pairing.userCode));
    await database.db.insert(agentDailyUsage).values({ subject: id, usageDate: '2000-01-01', count: 1 });
    const { operation } = await database.createBlog(id, `cleanup-${id.slice(0, 8)}`, 'alice');
    await database.db.insert(agentRequests).values([
      { userId: id, key: 'old-completed', requestHash: 'test', response: { status: 'unchanged' }, createdAt: old },
      { userId: id, key: 'old-pending', requestHash: 'test', response: { operationId: operation.id }, operationId: operation.id, createdAt: old },
    ]);
    await database.pruneTransientData(at);
    await expect(repository.grant(expired.token)).rejects.toMatchObject({ code: 'agent_unauthorized' });
    expect((await repository.grant(live.token)).userId).toBe(id);
    expect(await repository.authorization(id, expired.pairing.userCode)).toBeNull();
    expect((await database.db.select().from(agentRequests).where(eq(agentRequests.userId, id))).map((row) => row.key)).toEqual(['old-pending']);
    expect(await database.db.select().from(agentDailyUsage).where(eq(agentDailyUsage.subject, id))).toHaveLength(0);
    expect((await database.getOperation(operation.id))?.status).toBe('queued');
    expect((await database.listPendingOutbox()).some((row) => row.operationId === operation.id)).toBe(true);
  });
});
