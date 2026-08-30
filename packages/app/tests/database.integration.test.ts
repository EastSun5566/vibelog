import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { AppDatabase, MAX_OPERATION_ATTEMPTS } from '../src/database.js';
import { OutboxDispatcher } from '../src/jobs.js';
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
