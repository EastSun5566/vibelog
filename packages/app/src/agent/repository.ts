import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { AppDatabase, type BlogRecord, type OperationRecord } from '../database.js';
import { AppError } from '../http.js';
import { hashToken, randomToken } from '../security/crypto.js';
import * as schema from '../schema.js';
import { AGENT_TOKEN_SECONDS, PAIRING_SECONDS, requestHash, stateVersion } from './contracts.js';

type Grant = typeof schema.agentGrants.$inferSelect;
export interface AgentAuthorization {
  userCode: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed' | 'expired';
}
export interface AgentResult { operationId?: string; status: string; [key: string]: unknown }

export class AgentRepository {
  constructor(readonly database: AppDatabase) {}

  async limited(key: string, limit: number, seconds: number): Promise<void> {
    if (!await this.database.consumeRateLimit(`agent:${key}`, limit, seconds)) throw new AppError('rate_limited', 'Please wait before trying again.', 429, { 'Retry-After': String(seconds) });
  }
  async createPairing() {
    await this.limited('pairing:global', 100, 3600);
    const deviceCode = randomToken();
    const userCode = randomBytes(5).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + PAIRING_SECONDS * 1000);
    await this.database.db.insert(schema.agentPairings).values({ id: randomUUID(), deviceHash: hashToken(deviceCode), userCode, expiresAt });
    return { deviceCode, userCode, expiresAt: expiresAt.toISOString(), interval: 5 };
  }
  async authorization(userId: string, userCode: string): Promise<AgentAuthorization | null> {
    const [row] = await this.database.db.select({ userCode: schema.agentPairings.userCode, status: schema.agentPairings.status, expiresAt: schema.agentPairings.expiresAt })
      .from(schema.agentPairings).where(and(eq(schema.agentPairings.userCode, userCode), or(eq(schema.agentPairings.status, 'pending'), eq(schema.agentPairings.userId, userId))));
    if (!row) return null;
    return { userCode: row.userCode, status: (row.status === 'pending' || row.status === 'approved') && row.expiresAt <= new Date() ? 'expired' : row.status };
  }
  async approve(userId: string, userCode: string, approved: boolean): Promise<void> {
    await this.limited(`approve:${userId}`, 20, 3600);
    const [row] = await this.database.db.update(schema.agentPairings).set({ userId, status: approved ? 'approved' : 'denied', updatedAt: new Date() })
      .where(and(eq(schema.agentPairings.userCode, userCode), eq(schema.agentPairings.status, 'pending'), gt(schema.agentPairings.expiresAt, new Date()))).returning({ id: schema.agentPairings.id });
    if (!row) throw new AppError('pairing_unavailable', 'This request expired or has already been handled.', 409);
  }
  async redeem(deviceCode: string) {
    return this.database.transaction(async (db) => {
      const tx = db.db;
      const [row] = await tx.select().from(schema.agentPairings).where(eq(schema.agentPairings.deviceHash, hashToken(deviceCode))).for('update');
      if (!row || row.expiresAt <= new Date()) throw new AppError('pairing_expired', 'Start a new login request.', 410);
      if (row.status === 'pending') {
        if (Date.now() - row.updatedAt.getTime() < 5000) throw new AppError('slow_down', 'Poll no more than once every five seconds.', 429, { 'Retry-After': '5' });
        await new AgentRepository(db).limited('poll:global', 600, 60);
        await tx.update(schema.agentPairings).set({ updatedAt: new Date() }).where(eq(schema.agentPairings.id, row.id));
        return { status: 'pending' as const };
      }
      if (row.status !== 'approved' || !row.userId) throw new AppError('pairing_denied', 'This request was denied or already consumed.', 403);
      await new AgentRepository(db).limited('poll:global', 600, 60);
      const token = `vl_agent_${randomToken()}`;
      const expiresAt = new Date(Date.now() + AGENT_TOKEN_SECONDS * 1000);
      await tx.insert(schema.agentGrants).values({ id: randomUUID(), userId: row.userId, tokenHash: hashToken(token), expiresAt });
      await tx.update(schema.agentPairings).set({ status: 'consumed', updatedAt: new Date() }).where(eq(schema.agentPairings.id, row.id));
      return { status: 'approved' as const, token, expiresAt: expiresAt.toISOString() };
    });
  }
  async grant(token: string): Promise<Grant> {
    if (!/^vl_agent_[A-Za-z0-9_-]{43}$/u.test(token)) throw new AppError('agent_unauthorized', 'Sign in with the CLI.', 401);
    const [row] = await this.database.db.select().from(schema.agentGrants).where(and(eq(schema.agentGrants.tokenHash, hashToken(token)), gt(schema.agentGrants.expiresAt, new Date()), isNull(schema.agentGrants.revokedAt)));
    if (!row) throw new AppError('agent_unauthorized', 'This authorization expired or was revoked. Sign in again.', 401);
    return row;
  }
  async grants(userId: string) {
    return this.database.db.select({ id: schema.agentGrants.id, createdAt: schema.agentGrants.createdAt, expiresAt: schema.agentGrants.expiresAt }).from(schema.agentGrants)
      .where(and(eq(schema.agentGrants.userId, userId), gt(schema.agentGrants.expiresAt, new Date()), isNull(schema.agentGrants.revokedAt)));
  }
  async revoke(userId: string, id: string): Promise<void> {
    await this.database.db.update(schema.agentGrants).set({ revokedAt: new Date() }).where(and(eq(schema.agentGrants.userId, userId), eq(schema.agentGrants.id, id)));
  }

  async mutation(userId: string, key: string, action: string, input: Record<string, unknown>, work: (db: AppDatabase, blog: BlogRecord | null) => Promise<AgentResult>): Promise<AgentResult> {
    const hash = requestHash(action, input);
    return this.database.transaction(async (db) => {
      // Serialize requests without blocking the foreign-key checks used by browser operations.
      await db.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, userId)).for('no key update');
      const [previous] = await db.db.select().from(schema.agentRequests).where(and(eq(schema.agentRequests.userId, userId), eq(schema.agentRequests.key, key)));
      if (previous) {
        if (previous.requestHash !== hash) throw new AppError('idempotency_conflict', 'This request key was already used with different input.', 409);
        return previous.response as AgentResult;
      }
      const [lockedBlog] = await db.db.select().from(schema.blogs).where(eq(schema.blogs.userId, userId)).for('update');
      const blog = lockedBlog ? await db.getBlog(lockedBlog.id) : null;
      if (blog?.state === 'deleting') throw new AppError('deletion_in_progress', 'Finish deleting the blog first.', 409);
      if (action !== 'connect') {
        if (!blog) throw new AppError('blog_not_found', 'Connect HackMD first.', 404);
        if (input.stateVersion !== stateVersion(blog)) throw new AppError('state_changed', 'The draft changed. Read the context again and reconsider your edit.', 409);
        if (await db.getActiveOperation(blog.id, userId)) throw new AppError('operation_in_progress', 'Wait for the current operation.', 409);
      }
      const response = await work(db, blog);
      if (response.operationId) {
        // Shared global quota row is locked by the upsert; quota and operation roll back together.
        const at = new Date(); const date = at.toISOString().slice(0, 10);
        for (const [subject, limit] of [[userId, 10], ['*', 50]] as const) {
          const [usage] = await db.db.insert(schema.agentDailyUsage).values({ usageDate: date, subject, count: 1 })
            .onConflictDoUpdate({ target: [schema.agentDailyUsage.usageDate, schema.agentDailyUsage.subject], set: { count: sql`${schema.agentDailyUsage.count} + 1` } }).returning({ count: schema.agentDailyUsage.count });
          if (!usage || usage.count > limit) {
            const next = new Date(`${date}T00:00:00.000Z`).getTime() + 86400_000;
            throw new AppError('agent_build_quota_exceeded', 'Today’s agent build quota is exhausted.', 429, { 'Retry-After': String(Math.max(1, Math.ceil((next - at.getTime()) / 1000))) });
          }
        }
      }
      await db.db.insert(schema.agentRequests).values({ userId, key, requestHash: hash, response, operationId: response.operationId });
      return response;
    });
  }
}

export function operationResult(operation: OperationRecord): AgentResult {
  return { status: 'accepted', operationId: operation.id };
}
