import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { ThemeConfig } from '@vibelog/core';
import { DEFAULT_THEME, validateThemeConfig } from '@vibelog/core';
import { z } from 'zod';
import { parseSyncOperationPayload } from './blog-sync.js';
import type { OperationMessage } from './ports/operation-queue.js';
import * as schema from './schema.js';

export type BlogState = 'syncing' | 'ready' | 'failed';
export type OperationType = 'sync' | 'generate_theme' | 'publish';
export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type OperationProgress = { kind: 'indeterminate' } | { kind: 'determinate'; value: number; max: number };
export type ThemeRevisionSource = 'system' | 'ai' | 'manual';
export type ArtifactState = 'uploading' | 'ready' | 'cleanup_pending';
export interface SyncedPostTag { name: string; slug: string }
export interface SyncedPostSummary { title: string; slug: string; publishedAt: string; included: boolean; tags?: SyncedPostTag[]; updatedAt?: string; contentHash?: string }
export interface BlogRecord { id: string; userId: string; username: string; hackmdUsername: string; title: string | null; description: string | null; author: string | null; language: string; state: BlogState; lastError: string | null; draftArtifactId: string | null; contentVersion: number; contentManifest: SyncedPostSummary[] | null; lastSyncedAt: string | null; createdAt: string; updatedAt: string }
export interface ArtifactRecord { id: string; blogId: string; kind: 'draft' | 'release'; keyPrefix: string; state: ArtifactState; createdAt: string; readyAt: string | null }
export interface ThemeRevisionRecord { id: string; blogId: string; config: ThemeConfig; prompt: string | null; description: string; source: ThemeRevisionSource; active: boolean; createdAt: string }
export interface OperationRecord { id: string; userId: string; blogId: string; type: OperationType; status: OperationStatus; payload: Record<string, unknown>; result: Record<string, unknown> | null; errorMessage: string | null; attempts: number; lockedAt: string | null; leaseExpiresAt: string | null; createdAt: string; updatedAt: string }
export interface ReleaseSnapshot { site: { title: string; description: string; author: string; language: string }; posts: SyncedPostSummary[] }
export interface PublishedReleaseRecord { id: string; blogId: string; themeRevisionId: string; contentVersion: number; snapshot: ReleaseSnapshot | null; artifactId: string; active: boolean; createdAt: string }
export interface PreviewSessionRecord { tokenHash: string; userId: string; blogId: string; themeConfig: ThemeConfig | null; expiresAt: string }
export interface AiQuotaLimits { userDailyLimit: number; globalDailyLimit: number; at?: Date }
export interface OutboxRecord { id: string; operationId: string; message: OperationMessage }
export class AiQuotaExceededError extends Error { constructor(readonly retryAfter: number) { super('AI daily quota exceeded'); this.name = 'AiQuotaExceededError'; } }

export const MAX_OPERATION_ATTEMPTS = 3;
export const MAX_PUBLISHED_RELEASES = 20;
const syncedPostSummarySchema = z.object({
  title: z.string().min(1), slug: z.string().min(1),
  publishedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid published date'),
  included: z.boolean().default(true), tags: z.array(z.object({ name: z.string().min(1), slug: z.string().min(1) })).default([]),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid modified date').optional(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u, 'Invalid content digest').optional(),
});
const contentManifestSchema = z.array(syncedPostSummarySchema);
const releaseSnapshotSchema = z.object({ site: z.object({ title: z.string().min(1), description: z.string(), author: z.string().min(1), language: z.string().default('zh-Hant') }), posts: contentManifestSchema });
const iso = (value: Date | null) => value?.toISOString() ?? null;
const mapBlog = (row: typeof schema.blogs.$inferSelect): BlogRecord => ({ ...row, contentManifest: row.contentManifest ? contentManifestSchema.parse(row.contentManifest) : null, lastSyncedAt: iso(row.lastSyncedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const mapArtifact = (row: typeof schema.artifacts.$inferSelect): ArtifactRecord => ({ ...row, createdAt: row.createdAt.toISOString(), readyAt: iso(row.readyAt) });
const mapTheme = (row: typeof schema.themeRevisions.$inferSelect): ThemeRevisionRecord => ({ ...row, config: validateThemeConfig(row.config), createdAt: row.createdAt.toISOString() });
const mapOperation = (row: typeof schema.operations.$inferSelect): OperationRecord => ({ ...row, payload: row.payload, result: row.result, lockedAt: iso(row.lockedAt), leaseExpiresAt: iso(row.leaseExpiresAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const mapPreview = (row: typeof schema.previewSessions.$inferSelect): PreviewSessionRecord => ({ ...row, themeConfig: row.themeConfig ? validateThemeConfig(row.themeConfig) : null, expiresAt: row.expiresAt.toISOString() });
const mapRelease = (row: typeof schema.publishedReleases.$inferSelect): PublishedReleaseRecord => ({ ...row, snapshot: row.snapshot ? releaseSnapshotSchema.parse(row.snapshot) : null, createdAt: row.createdAt.toISOString() });
function quotaWindow(at: Date): { date: string; retryAfter: number } { const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1); return { date: at.toISOString().slice(0, 10), retryAfter: Math.max(1, Math.ceil((next - at.getTime()) / 1000)) }; }
function newOperation(userId: string, blogId: string, type: OperationType, payload: Record<string, unknown>) {
  const timestamp = new Date();
  return { id: randomUUID(), userId, blogId, type, status: 'queued' as const, payload, result: null, errorMessage: null, attempts: 0, lockedAt: null, leaseExpiresAt: null, createdAt: timestamp, updatedAt: timestamp };
}
function operationMessage(operationId: string): OperationMessage { return { version: 1, operationId, traceId: randomUUID(), createdAt: new Date().toISOString() }; }
async function insertOutbox(tx: NodePgDatabase<typeof schema>, operationId: string): Promise<void> {
  await tx.insert(schema.operationOutbox).values({ id: randomUUID(), operationId, payload: operationMessage(operationId) as unknown as Record<string, unknown> });
}

export class AppDatabase {
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
  constructor(databaseUrl: string, options: { max?: number } = {}) {
    this.pool = new Pool({ connectionString: databaseUrl, max: options.max ?? 10, application_name: 'vibelog' });
    this.db = drizzle(this.pool, { schema });
  }
  async close(): Promise<void> { await this.pool.end(); }
  async ping(): Promise<void> { await this.pool.query('select 1'); }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number, at = new Date()): Promise<boolean> {
    const timestamp = Math.floor(at.getTime() / 1000);
    const [row] = await this.db.insert(schema.rateLimit).values({ id: randomUUID(), key, count: 1, lastRequest: timestamp }).onConflictDoUpdate({
      target: schema.rateLimit.key,
      set: {
        count: sql`case when ${schema.rateLimit.lastRequest} <= ${timestamp - windowSeconds} then 1 else ${schema.rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${schema.rateLimit.lastRequest} <= ${timestamp - windowSeconds} then ${timestamp} else ${schema.rateLimit.lastRequest} end`,
      },
    }).returning({ count: schema.rateLimit.count });
    return Boolean(row && row.count <= limit);
  }

  async createBlog(userId: string, username: string, hackmdUsername: string, language = 'en'): Promise<{ blog: BlogRecord; operation: OperationRecord }> {
    const id = randomUUID(); const op = newOperation(userId, id, 'sync', { intent: 'content', excludedSlugs: [] });
    return this.db.transaction(async (tx) => {
      const [blog] = await tx.insert(schema.blogs).values({ id, userId, username, hackmdUsername, language, state: 'syncing' }).returning();
      await tx.insert(schema.themeRevisions).values({ id: randomUUID(), blogId: id, config: DEFAULT_THEME, description: DEFAULT_THEME.description, source: 'system', active: true });
      const [operation] = await tx.insert(schema.operations).values(op).returning();
      await insertOutbox(tx, operation.id);
      return { blog: mapBlog(blog), operation: mapOperation(operation) };
    });
  }
  async getBlogForUser(userId: string): Promise<BlogRecord | null> { const [row] = await this.db.select().from(schema.blogs).where(eq(schema.blogs.userId, userId)); return row ? mapBlog(row) : null; }
  async getBlog(id: string): Promise<BlogRecord | null> { const [row] = await this.db.select().from(schema.blogs).where(eq(schema.blogs.id, id)); return row ? mapBlog(row) : null; }
  async getBlogByUsername(username: string): Promise<BlogRecord | null> { const [row] = await this.db.select().from(schema.blogs).where(eq(schema.blogs.username, username)); return row ? mapBlog(row) : null; }
  async retryInitialSync(userId: string, hackmdUsername: string, language: string): Promise<OperationRecord> {
    return this.db.transaction(async (tx) => {
      const [blog] = await tx.select().from(schema.blogs).where(eq(schema.blogs.userId, userId));
      if (!blog) throw new Error('Blog not found');
      if (blog.draftArtifactId) throw new Error('Blog already has synced content');
      const [active] = await tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blog.id), inArray(schema.operations.status, ['queued', 'running'])));
      if (active) throw new Error('Blog already has an active operation');
      const op = newOperation(userId, blog.id, 'sync', { intent: 'content', excludedSlugs: [] });
      await tx.update(schema.blogs).set({ hackmdUsername, language, state: 'syncing', lastError: null, updatedAt: new Date() }).where(eq(schema.blogs.id, blog.id));
      const [row] = await tx.insert(schema.operations).values(op).returning(); await insertOutbox(tx, row.id); return mapOperation(row);
    });
  }
  async createArtifact(blogId: string, kind: 'draft' | 'release', id = randomUUID()): Promise<ArtifactRecord> {
    const [row] = await this.db.insert(schema.artifacts).values({ id, blogId, kind, keyPrefix: `artifacts/${id}/`, state: 'uploading' }).returning();
    return mapArtifact(row);
  }
  async getArtifact(id: string): Promise<ArtifactRecord | null> { const [row] = await this.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, id)); return row ? mapArtifact(row) : null; }
  async markArtifactCleanup(id: string): Promise<void> { await this.db.update(schema.artifacts).set({ state: 'cleanup_pending' }).where(eq(schema.artifacts.id, id)); }
  async completeSyncOperation(operationId: string, metadata: { title: string; description: string; author: string; language?: string; artifactId: string; contentManifest?: SyncedPostSummary[]; lastSyncedAt?: string }, result: Record<string, unknown>): Promise<void> {
    const syncedAt = metadata.lastSyncedAt ? new Date(metadata.lastSyncedAt) : new Date();
    const manifest = contentManifestSchema.parse(metadata.contentManifest ?? []).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
    await this.db.transaction(async (tx) => {
      const [operation] = await tx.select().from(schema.operations).where(and(eq(schema.operations.id, operationId), eq(schema.operations.type, 'sync'), eq(schema.operations.status, 'running')));
      if (!operation) throw new Error('Active sync operation not found');
      const [artifact] = await tx.update(schema.artifacts).set({ state: 'ready', readyAt: new Date() }).where(and(eq(schema.artifacts.id, metadata.artifactId), eq(schema.artifacts.blogId, operation.blogId), eq(schema.artifacts.state, 'uploading'))).returning();
      if (!artifact) throw new Error('Uploading artifact not found');
      const [blog] = await tx.select({ draftArtifactId: schema.blogs.draftArtifactId }).from(schema.blogs).where(eq(schema.blogs.id, operation.blogId));
      await tx.update(schema.blogs).set({ title: metadata.title, description: metadata.description, author: metadata.author, language: metadata.language, contentManifest: manifest, lastSyncedAt: syncedAt, contentVersion: sql`${schema.blogs.contentVersion} + 1`, state: 'ready', lastError: null, draftArtifactId: artifact.id, updatedAt: syncedAt }).where(and(eq(schema.blogs.id, operation.blogId), eq(schema.blogs.userId, operation.userId)));
      if (blog?.draftArtifactId) await tx.update(schema.artifacts).set({ state: 'cleanup_pending' }).where(eq(schema.artifacts.id, blog.draftArtifactId));
      await tx.update(schema.operations).set({ status: 'succeeded', result, errorMessage: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, operationId));
    });
  }
  async failSync(blogId: string, message: string): Promise<void> { const blog = await this.getBlog(blogId); await this.db.update(schema.blogs).set({ state: blog?.draftArtifactId ? 'ready' : 'failed', lastError: message, updatedAt: new Date() }).where(eq(schema.blogs.id, blogId)); }

  async listThemes(blogId: string): Promise<ThemeRevisionRecord[]> { return (await this.db.select().from(schema.themeRevisions).where(eq(schema.themeRevisions.blogId, blogId)).orderBy(desc(schema.themeRevisions.createdAt))).map(mapTheme); }
  async getTheme(id: string, blogId: string): Promise<ThemeRevisionRecord | null> { const [row] = await this.db.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.id, id), eq(schema.themeRevisions.blogId, blogId))); return row ? mapTheme(row) : null; }
  async getActiveTheme(blogId: string): Promise<ThemeRevisionRecord | null> { const [row] = await this.db.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.blogId, blogId), eq(schema.themeRevisions.active, true))); return row ? mapTheme(row) : null; }
  async completeThemeOperation(operationId: string, config: ThemeConfig, result: Record<string, unknown>): Promise<ThemeRevisionRecord> {
    const validated = validateThemeConfig(config);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.operations).where(and(eq(schema.operations.id, operationId), eq(schema.operations.type, 'generate_theme'), eq(schema.operations.status, 'running')));
      if (!row) throw new Error('Active theme operation not found');
      const prompt = row.payload.prompt; if (typeof prompt !== 'string') throw new Error('Theme description is required');
      await tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, row.blogId));
      const [revision] = await tx.insert(schema.themeRevisions).values({ id: randomUUID(), blogId: row.blogId, config: validated, prompt, description: validated.description, source: 'ai', active: true }).returning();
      await tx.update(schema.operations).set({ status: 'succeeded', result: { ...result, revisionId: revision.id }, errorMessage: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, operationId));
      return mapTheme(revision);
    });
  }
  async createManualTheme(userId: string, blogId: string, config: ThemeConfig): Promise<ThemeRevisionRecord> {
    const validated = validateThemeConfig(config);
    return this.db.transaction(async (tx) => {
      const [blog] = await tx.select({ id: schema.blogs.id }).from(schema.blogs).where(and(eq(schema.blogs.id, blogId), eq(schema.blogs.userId, userId))); if (!blog) throw new Error('Blog not found');
      const [active] = await tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))); if (active) throw new Error('Blog already has an active operation');
      await tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, blogId));
      const [row] = await tx.insert(schema.themeRevisions).values({ id: randomUUID(), blogId, config: validated, description: validated.description, source: 'manual', active: true }).returning(); return mapTheme(row);
    });
  }
  async activateTheme(id: string, blogId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [active] = await tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))); if (active) throw new Error('Blog already has an active operation');
      const [found] = await tx.select({ id: schema.themeRevisions.id }).from(schema.themeRevisions).where(and(eq(schema.themeRevisions.id, id), eq(schema.themeRevisions.blogId, blogId))); if (!found) throw new Error('Theme revision not found');
      await tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, blogId)); await tx.update(schema.themeRevisions).set({ active: true }).where(eq(schema.themeRevisions.id, id));
    });
  }

  private async createOperation(userId: string, blogId: string, type: OperationType, payload: Record<string, unknown>): Promise<OperationRecord> {
    const op = newOperation(userId, blogId, type, payload);
    return this.db.transaction(async (tx) => { const [row] = await tx.insert(schema.operations).values(op).returning(); await insertOutbox(tx, row.id); return mapOperation(row); });
  }
  async createSyncOperation(userId: string, blogId: string, payload: Record<string, unknown>): Promise<OperationRecord> {
    const blog = await this.getBlog(blogId); if (!blog || blog.userId !== userId) throw new Error('Blog not found');
    const parsed = parseSyncOperationPayload(payload); const currentExcluded = blog.contentManifest?.filter((post) => !post.included).map((post) => post.slug) ?? [];
    const excludedSlugs = [...new Set(parsed.excludedSlugs ?? currentExcluded)].sort();
    if (parsed.intent === 'identity' && parsed.site?.title === blog.title && parsed.site.description === (blog.description ?? '') && parsed.site.language === blog.language) throw new Error('Nothing to update');
    if (parsed.intent === 'selection') {
      if (!blog.contentManifest?.length) throw new Error('Article selection unavailable');
      const known = new Set(blog.contentManifest.map((post) => post.slug)); if (excludedSlugs.some((slug) => !known.has(slug))) throw new Error('Unknown article selection');
      if (excludedSlugs.length === blog.contentManifest.length) throw new Error('No articles selected');
      const old = [...currentExcluded].sort(); if (old.length === excludedSlugs.length && old.every((slug, index) => slug === excludedSlugs[index])) throw new Error('Nothing to update article selection');
    }
    return this.createOperation(userId, blogId, 'sync', { ...parsed, excludedSlugs });
  }
  async createPublishOperation(userId: string, blogId: string, previewTokenHash: string): Promise<OperationRecord> {
    const blog = await this.getBlog(blogId); if (!blog || blog.userId !== userId || !blog.draftArtifactId) throw new Error('Blog has no synced content');
    const theme = await this.getActiveTheme(blogId); if (!theme) throw new Error('Active theme not found');
    const preview = await this.getPreviewSession(previewTokenHash); if (!preview || preview.userId !== userId || preview.blogId !== blogId) throw new Error('Preview session expired or invalid');
    if (preview.themeConfig && JSON.stringify(preview.themeConfig) !== JSON.stringify(theme.config)) throw new Error('Preview has unsaved theme changes');
    const release = await this.getActiveRelease(blogId); if (release?.contentVersion === blog.contentVersion && release.themeRevisionId === theme.id) throw new Error('Nothing to publish');
    return this.createOperation(userId, blogId, 'publish', { contentVersion: blog.contentVersion, themeRevisionId: theme.id });
  }
  async createThemeOperation(userId: string, blogId: string, prompt: string, baseTheme: unknown, limits: AiQuotaLimits, previewPath = '/'): Promise<OperationRecord> {
    const validatedBase = validateThemeConfig(baseTheme); const at = limits.at ?? new Date(); const window = quotaWindow(at);
    return this.db.transaction(async (tx) => {
      const [active] = await tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))); if (active) throw new Error('Blog already has an active operation');
      const op = newOperation(userId, blogId, 'generate_theme', { prompt, baseTheme: validatedBase, previewPath });
      for (const item of [{ scope: 'user' as const, subject: userId, limit: limits.userDailyLimit }, { scope: 'global' as const, subject: '*', limit: limits.globalDailyLimit }]) {
        const [usage] = await tx.insert(schema.aiDailyUsage).values({ usageDate: window.date, scope: item.scope, subject: item.subject, count: 1 }).onConflictDoUpdate({ target: [schema.aiDailyUsage.usageDate, schema.aiDailyUsage.scope, schema.aiDailyUsage.subject], set: { count: sql`${schema.aiDailyUsage.count} + 1` } }).returning({ count: schema.aiDailyUsage.count });
        if (!usage || usage.count > item.limit) throw new AiQuotaExceededError(window.retryAfter);
      }
      const [row] = await tx.insert(schema.operations).values(op).returning(); await insertOutbox(tx, row.id);
      return mapOperation(row);
    });
  }
  async getOperation(id: string, userId?: string): Promise<OperationRecord | null> {
    const where = userId ? and(eq(schema.operations.id, id), eq(schema.operations.userId, userId)) : eq(schema.operations.id, id);
    const [row] = await this.db.select().from(schema.operations).where(where); return row ? mapOperation(row) : null;
  }
  async getActiveOperation(blogId: string, userId: string): Promise<OperationRecord | null> { const [row] = await this.db.select().from(schema.operations).where(and(eq(schema.operations.blogId, blogId), eq(schema.operations.userId, userId), inArray(schema.operations.status, ['queued', 'running']))); return row ? mapOperation(row) : null; }
  async claimOperation(id: string, leaseSeconds = 35 * 60): Promise<OperationRecord | null> {
    const now = new Date(); const lease = new Date(now.getTime() + leaseSeconds * 1000);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(schema.operations).set({ status: 'running', attempts: sql`${schema.operations.attempts} + 1`, lockedAt: now, leaseExpiresAt: lease, updatedAt: now })
        .where(and(eq(schema.operations.id, id), lt(schema.operations.attempts, MAX_OPERATION_ATTEMPTS), or(eq(schema.operations.status, 'queued'), and(eq(schema.operations.status, 'running'), lt(schema.operations.leaseExpiresAt, now))))).returning();
      if (row) return mapOperation(row);
      const exhaustedMessage = 'Operation stopped after repeated worker interruptions.';
      const [exhausted] = await tx.update(schema.operations).set({ status: 'failed', errorMessage: exhaustedMessage, leaseExpiresAt: null, updatedAt: now })
        .where(and(eq(schema.operations.id, id), eq(schema.operations.status, 'running'), sql`${schema.operations.attempts} >= ${MAX_OPERATION_ATTEMPTS}`, lt(schema.operations.leaseExpiresAt, now))).returning();
      if (exhausted?.type === 'sync') {
        const [blog] = await tx.select({ draftArtifactId: schema.blogs.draftArtifactId }).from(schema.blogs).where(eq(schema.blogs.id, exhausted.blogId));
        await tx.update(schema.blogs).set({ state: blog?.draftArtifactId ? 'ready' : 'failed', lastError: exhaustedMessage, updatedAt: now }).where(eq(schema.blogs.id, exhausted.blogId));
      }
      return null;
    });
  }
  async updateOperationProgress(id: string, progress: OperationProgress, message: string): Promise<void> { await this.db.update(schema.operations).set({ result: { progress, progressMessage: message }, updatedAt: new Date() }).where(and(eq(schema.operations.id, id), eq(schema.operations.status, 'running'))); }
  async completeOperation(id: string, result: Record<string, unknown> = {}): Promise<void> { await this.db.update(schema.operations).set({ status: 'succeeded', result, errorMessage: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, id)); }
  async failOperation(id: string, message: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [operation] = await tx.select().from(schema.operations).where(and(eq(schema.operations.id, id), inArray(schema.operations.status, ['queued', 'running']))); if (!operation) return;
      await tx.update(schema.operations).set({ status: 'failed', errorMessage: message, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, id));
      if (operation.type === 'sync') {
        const [blog] = await tx.select({ draftArtifactId: schema.blogs.draftArtifactId }).from(schema.blogs).where(eq(schema.blogs.id, operation.blogId));
        await tx.update(schema.blogs).set({ state: blog?.draftArtifactId ? 'ready' : 'failed', lastError: message, updatedAt: new Date() }).where(eq(schema.blogs.id, operation.blogId));
      }
    });
  }
  async listPendingOutbox(limit = 100): Promise<OutboxRecord[]> {
    const rows = await this.db.select().from(schema.operationOutbox).where(isNull(schema.operationOutbox.dispatchedAt)).orderBy(asc(schema.operationOutbox.createdAt)).limit(limit);
    return rows.map((row) => ({ id: row.id, operationId: row.operationId, message: row.payload as unknown as OperationMessage }));
  }
  async markOutboxDispatched(id: string): Promise<void> { await this.db.update(schema.operationOutbox).set({ dispatchedAt: new Date(), attempts: sql`${schema.operationOutbox.attempts} + 1` }).where(eq(schema.operationOutbox.id, id)); }
  async noteOutboxAttempt(id: string): Promise<void> { await this.db.update(schema.operationOutbox).set({ attempts: sql`${schema.operationOutbox.attempts} + 1` }).where(eq(schema.operationOutbox.id, id)); }

  async completePublishOperation(operationId: string, artifactId: string, snapshot: ReleaseSnapshot, result: Record<string, unknown>): Promise<PublishedReleaseRecord> {
    const validated = releaseSnapshotSchema.parse(snapshot);
    return this.db.transaction(async (tx) => {
      const [operation] = await tx.select().from(schema.operations).where(and(eq(schema.operations.id, operationId), eq(schema.operations.type, 'publish'), eq(schema.operations.status, 'running'))); if (!operation) throw new Error('Active publish operation not found');
      const contentVersion = operation.payload.contentVersion; const themeRevisionId = operation.payload.themeRevisionId;
      if (!Number.isInteger(contentVersion) || typeof themeRevisionId !== 'string') throw new Error('Publish snapshot is invalid');
      const [blog] = await tx.select({ contentVersion: schema.blogs.contentVersion }).from(schema.blogs).where(and(eq(schema.blogs.id, operation.blogId), eq(schema.blogs.userId, operation.userId)));
      if (!blog || blog.contentVersion !== contentVersion) throw new Error('Draft changed before publishing');
      const [artifact] = await tx.update(schema.artifacts).set({ state: 'ready', readyAt: new Date() }).where(and(eq(schema.artifacts.id, artifactId), eq(schema.artifacts.blogId, operation.blogId), eq(schema.artifacts.state, 'uploading'))).returning(); if (!artifact) throw new Error('Uploading artifact not found');
      await tx.update(schema.publishedReleases).set({ active: false }).where(eq(schema.publishedReleases.blogId, operation.blogId));
      const [release] = await tx.insert(schema.publishedReleases).values({ id: randomUUID(), blogId: operation.blogId, themeRevisionId, contentVersion, snapshot: validated, artifactId, active: true }).returning();
      await tx.update(schema.operations).set({ status: 'succeeded', result, errorMessage: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, operationId));
      return mapRelease(release);
    });
  }
  async getActiveRelease(blogId: string): Promise<PublishedReleaseRecord | null> { const [row] = await this.db.select().from(schema.publishedReleases).where(and(eq(schema.publishedReleases.blogId, blogId), eq(schema.publishedReleases.active, true))); return row ? mapRelease(row) : null; }
  async listReleases(blogId: string): Promise<PublishedReleaseRecord[]> { return (await this.db.select().from(schema.publishedReleases).where(eq(schema.publishedReleases.blogId, blogId)).orderBy(desc(schema.publishedReleases.createdAt))).map(mapRelease); }
  async getRelease(id: string, blogId: string): Promise<PublishedReleaseRecord | null> { const [row] = await this.db.select().from(schema.publishedReleases).where(and(eq(schema.publishedReleases.id, id), eq(schema.publishedReleases.blogId, blogId))); return row ? mapRelease(row) : null; }
  async activateExistingRelease(id: string, blogId: string): Promise<PublishedReleaseRecord> {
    return this.db.transaction(async (tx) => {
      const [release] = await tx.select().from(schema.publishedReleases).where(and(eq(schema.publishedReleases.id, id), eq(schema.publishedReleases.blogId, blogId))); if (!release) throw new Error('Release not found'); if (release.active) throw new Error('Release already active');
      const [active] = await tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))); if (active) throw new Error('Blog already has an active operation');
      await tx.update(schema.publishedReleases).set({ active: false }).where(eq(schema.publishedReleases.blogId, blogId)); await tx.update(schema.publishedReleases).set({ active: true }).where(eq(schema.publishedReleases.id, id)); return mapRelease({ ...release, active: true });
    });
  }
  async prunePublishedReleases(blogId?: string): Promise<string[]> {
    const blogIds = blogId ? [blogId] : (await this.db.selectDistinct({ blogId: schema.publishedReleases.blogId }).from(schema.publishedReleases)).map((row) => row.blogId);
    const removed: string[] = [];
    await this.db.transaction(async (tx) => {
      for (const id of blogIds) {
        const releases = await tx.select({ id: schema.publishedReleases.id, artifactId: schema.publishedReleases.artifactId, active: schema.publishedReleases.active }).from(schema.publishedReleases).where(eq(schema.publishedReleases.blogId, id)).orderBy(desc(schema.publishedReleases.createdAt));
        const kept = new Set(releases.filter((release) => release.active).map((release) => release.id));
        for (const release of releases) if (!release.active && kept.size < MAX_PUBLISHED_RELEASES) kept.add(release.id);
        const expired = releases.filter((release) => !kept.has(release.id)); if (!expired.length) continue;
        await tx.delete(schema.publishedReleases).where(inArray(schema.publishedReleases.id, expired.map((release) => release.id)));
        await tx.update(schema.artifacts).set({ state: 'cleanup_pending' }).where(inArray(schema.artifacts.id, expired.map((release) => release.artifactId)));
        removed.push(...expired.map((release) => release.artifactId));
      }
    });
    return removed;
  }
  async listCleanupArtifacts(limit = 100): Promise<ArtifactRecord[]> { return (await this.db.select().from(schema.artifacts).where(eq(schema.artifacts.state, 'cleanup_pending')).limit(limit)).map(mapArtifact); }
  async deleteArtifactRecord(id: string): Promise<void> { await this.db.delete(schema.artifacts).where(and(eq(schema.artifacts.id, id), eq(schema.artifacts.state, 'cleanup_pending'))); }

  async createPreviewSession(tokenHash: string, userId: string, blogId: string, expiresAt: string, themeConfig: ThemeConfig): Promise<void> {
    const validated = validateThemeConfig(themeConfig); await this.db.transaction(async (tx) => { await tx.delete(schema.previewSessions).where(lt(schema.previewSessions.expiresAt, new Date())); await tx.insert(schema.previewSessions).values({ tokenHash, userId, blogId, themeConfig: validated, expiresAt: new Date(expiresAt) }); });
  }
  async getPreviewSession(tokenHash: string): Promise<PreviewSessionRecord | null> { const [row] = await this.db.select().from(schema.previewSessions).where(and(eq(schema.previewSessions.tokenHash, tokenHash), gt(schema.previewSessions.expiresAt, new Date()))); return row ? mapPreview(row) : null; }
  async updatePreviewTheme(tokenHash: string, userId: string, blogId: string, config: ThemeConfig): Promise<ThemeConfig> {
    const validated = validateThemeConfig(config); const [row] = await this.db.update(schema.previewSessions).set({ themeConfig: validated }).where(and(eq(schema.previewSessions.tokenHash, tokenHash), eq(schema.previewSessions.userId, userId), eq(schema.previewSessions.blogId, blogId), gt(schema.previewSessions.expiresAt, new Date()))).returning();
    if (!row) throw new Error('Preview session expired or invalid'); return validated;
  }
}
