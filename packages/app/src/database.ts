import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { BlogDesignSpecV1, ContentProfile } from '@vibelog/core';
import { DEFAULT_DESIGN, contentProfileSchema, parsePersistedDesign, validateBlogDesignSpec } from '@vibelog/core';
import { z } from 'zod';
import { parseSyncOperationPayload } from './blog-sync.js';
import type { OperationMessage } from './ports/operation-queue.js';
import * as schema from './schema.js';

export type BlogState = 'syncing' | 'ready' | 'failed' | 'deleting';
export type OperationType = 'sync' | 'generate_design' | 'apply_design' | 'activate_design' | 'publish';
export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type OperationProgress = { kind: 'indeterminate' } | { kind: 'determinate'; value: number; max: number };
export type ThemeRevisionSource = 'system' | 'ai' | 'manual';
export type ArtifactState = 'uploading' | 'ready' | 'cleanup_pending';
export interface SyncedPostTag { name: string; slug: string }
export interface SyncedPostSummary { title: string; slug: string; description?: string; publishedAt: string; included: boolean; tags?: SyncedPostTag[]; updatedAt?: string; contentHash?: string }
export interface BlogRecord { id: string; userId: string; username: string; hackmdUsername: string; title: string | null; description: string | null; author: string | null; language: string; state: BlogState; lastError: string | null; sourceArtifactId: string | null; draftArtifactId: string | null; draftDesignRevisionId: string | null; contentVersion: number; contentProfile: ContentProfile | null; contentManifest: SyncedPostSummary[] | null; lastSyncedAt: string | null; createdAt: string; updatedAt: string }
export interface ArtifactRecord { id: string; blogId: string; kind: 'source' | 'draft' | 'release'; keyPrefix: string; state: ArtifactState; createdAt: string; readyAt: string | null }
export interface DesignRevisionRecord { id: string; blogId: string; config: BlogDesignSpecV1; prompt: string | null; description: string; source: ThemeRevisionSource; active: boolean; createdAt: string }
/** Legacy name retained only for downstream source compatibility. */
export type ThemeRevisionRecord = DesignRevisionRecord;
export interface OperationRecord { id: string; userId: string; blogId: string; type: OperationType; status: OperationStatus; payload: Record<string, unknown>; result: Record<string, unknown> | null; errorMessage: string | null; attempts: number; lockedAt: string | null; leaseExpiresAt: string | null; createdAt: string; updatedAt: string }
type OperationLease = Pick<OperationRecord, 'id' | 'attempts'>;
export class OperationLeaseLostError extends Error { constructor() { super('Operation lease is no longer owned'); this.name = 'OperationLeaseLostError'; } }
export interface ReleaseSnapshot { site: { title: string; description: string; author: string; language: string }; posts: SyncedPostSummary[] }
export interface PublishedReleaseRecord { id: string; blogId: string; themeRevisionId: string; contentVersion: number; snapshot: ReleaseSnapshot | null; artifactId: string; active: boolean; createdAt: string }
export interface PreviewSessionRecord { tokenHash: string; userId: string; blogId: string; designConfig: BlogDesignSpecV1 | null; expiresAt: string }
export interface BlogDeletionPlan { blogId: string; artifacts: ArtifactRecord[] }
export interface AiQuotaLimits { userDailyLimit: number; globalDailyLimit: number; at?: Date }
export interface OutboxRecord { id: string; operationId: string; message: OperationMessage }
export interface TransientCleanupResult { previewSessions: number; operations: number; aiUsage: number; rateLimits: number }
export class AiQuotaExceededError extends Error { constructor(readonly retryAfter: number) { super('AI daily quota exceeded'); this.name = 'AiQuotaExceededError'; } }
export class BlogAddressTakenError extends Error { constructor(readonly username: string) { super(`Blog address is already taken: ${username}`); this.name = 'BlogAddressTakenError'; } }

export const MAX_OPERATION_ATTEMPTS = 3;
const OPERATION_LEASE_SECONDS = 35 * 60;
function ownedLease(lease: OperationLease) {
  return and(eq(schema.operations.id, lease.id), eq(schema.operations.status, 'running'), eq(schema.operations.attempts, lease.attempts), gt(schema.operations.leaseExpiresAt, sql`now()`));
}
export const MAX_PUBLISHED_RELEASES = 20;
const syncedPostSummarySchema = z.object({
  title: z.string().min(1), slug: z.string().min(1),
  description: z.string().optional(),
  publishedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid published date'),
  included: z.boolean().default(true), tags: z.array(z.object({ name: z.string().min(1), slug: z.string().min(1) })).default([]),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid modified date').optional(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u, 'Invalid content digest').optional(),
});
const contentManifestSchema = z.array(syncedPostSummarySchema);
const releaseSnapshotSchema = z.object({ site: z.object({ title: z.string().min(1), description: z.string(), author: z.string().min(1), language: z.string().default('zh-Hant') }), posts: contentManifestSchema });
const iso = (value: Date | null) => value?.toISOString() ?? null;
const mapBlog = (row: typeof schema.blogs.$inferSelect): BlogRecord => ({ ...row, contentProfile: row.contentProfile ? contentProfileSchema.parse(row.contentProfile) : null, contentManifest: row.contentManifest ? contentManifestSchema.parse(row.contentManifest) : null, lastSyncedAt: iso(row.lastSyncedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const mapArtifact = (row: typeof schema.artifacts.$inferSelect): ArtifactRecord => ({ ...row, createdAt: row.createdAt.toISOString(), readyAt: iso(row.readyAt) });
const mapTheme = (row: typeof schema.themeRevisions.$inferSelect): DesignRevisionRecord => ({ ...row, config: parsePersistedDesign(row.config), createdAt: row.createdAt.toISOString() });
const mapOperation = (row: typeof schema.operations.$inferSelect): OperationRecord => ({ ...row, payload: row.payload, result: row.result, lockedAt: iso(row.lockedAt), leaseExpiresAt: iso(row.leaseExpiresAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const mapPreview = (row: typeof schema.previewSessions.$inferSelect): PreviewSessionRecord => ({ tokenHash: row.tokenHash, userId: row.userId, blogId: row.blogId, designConfig: row.themeConfig ? parsePersistedDesign(row.themeConfig) : null, expiresAt: row.expiresAt.toISOString() });
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
      const [blog] = await tx.insert(schema.blogs).values({ id, userId, username, hackmdUsername, language, state: 'syncing' })
        .onConflictDoNothing({ target: schema.blogs.username }).returning();
      if (!blog) throw new BlogAddressTakenError(username);
      await tx.insert(schema.themeRevisions).values({ id: randomUUID(), blogId: id, config: DEFAULT_DESIGN, description: DEFAULT_DESIGN.description, source: 'system', active: true });
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
  async createArtifact(blogId: string, kind: 'source' | 'draft' | 'release', id = randomUUID()): Promise<ArtifactRecord> {
    const [row] = await this.db.insert(schema.artifacts).values({ id, blogId, kind, keyPrefix: `artifacts/${id}/`, state: 'uploading' }).returning();
    return mapArtifact(row);
  }
  async getArtifact(id: string): Promise<ArtifactRecord | null> { const [row] = await this.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, id)); return row ? mapArtifact(row) : null; }
  async markArtifactCleanup(id: string): Promise<void> { await this.db.update(schema.artifacts).set({ state: 'cleanup_pending' }).where(and(eq(schema.artifacts.id, id), eq(schema.artifacts.state, 'uploading'))); }
  async completeSyncOperation(lease: OperationLease, metadata: { title: string; description: string; author: string; language?: string; sourceArtifactId: string; draftArtifactId: string; designRevisionId: string; contentProfile: ContentProfile; contentManifest?: SyncedPostSummary[]; lastSyncedAt?: string }, result: Record<string, unknown>): Promise<void> {
    const syncedAt = metadata.lastSyncedAt ? new Date(metadata.lastSyncedAt) : new Date();
    const manifest = contentManifestSchema.parse(metadata.contentManifest ?? []).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
    const profile = contentProfileSchema.parse(metadata.contentProfile);
    await this.db.transaction(async (tx) => {
      const [operation] = await tx.select().from(schema.operations).where(and(ownedLease(lease), eq(schema.operations.type, 'sync'))).for('update');
      if (!operation) throw new OperationLeaseLostError();
      const ready = await tx.update(schema.artifacts).set({ state: 'ready', readyAt: new Date() }).where(and(inArray(schema.artifacts.id, [metadata.sourceArtifactId, metadata.draftArtifactId]), eq(schema.artifacts.blogId, operation.blogId), eq(schema.artifacts.state, 'uploading'))).returning({ id: schema.artifacts.id });
      if (ready.length !== 2) throw new Error('Uploading source or draft artifact not found');
      const [blog] = await tx.select({ sourceArtifactId: schema.blogs.sourceArtifactId, draftArtifactId: schema.blogs.draftArtifactId }).from(schema.blogs).where(eq(schema.blogs.id, operation.blogId));
      await tx.update(schema.blogs).set({ title: metadata.title, description: metadata.description, author: metadata.author, language: metadata.language, contentProfile: profile, contentManifest: manifest, lastSyncedAt: syncedAt, contentVersion: sql`${schema.blogs.contentVersion} + 1`, state: 'ready', lastError: null, sourceArtifactId: metadata.sourceArtifactId, draftArtifactId: metadata.draftArtifactId, draftDesignRevisionId: metadata.designRevisionId, updatedAt: syncedAt }).where(and(eq(schema.blogs.id, operation.blogId), eq(schema.blogs.userId, operation.userId)));
      const expired = [blog?.sourceArtifactId, blog?.draftArtifactId].filter((id): id is string => Boolean(id));
      if (expired.length) await tx.update(schema.artifacts).set({ state: 'cleanup_pending' }).where(inArray(schema.artifacts.id, expired));
      await tx.update(schema.operations).set({ status: 'succeeded', result, errorMessage: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, lease.id));
    });
  }
  async failSync(blogId: string, message: string): Promise<void> { const blog = await this.getBlog(blogId); await this.db.update(schema.blogs).set({ state: blog?.draftArtifactId ? 'ready' : 'failed', lastError: message, updatedAt: new Date() }).where(eq(schema.blogs.id, blogId)); }

  async listDesignRevisions(blogId: string): Promise<DesignRevisionRecord[]> { return (await this.db.select().from(schema.themeRevisions).where(eq(schema.themeRevisions.blogId, blogId)).orderBy(desc(schema.themeRevisions.createdAt))).map(mapTheme); }
  async getDesignRevision(id: string, blogId: string): Promise<DesignRevisionRecord | null> { const [row] = await this.db.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.id, id), eq(schema.themeRevisions.blogId, blogId))); return row ? mapTheme(row) : null; }
  async getActiveDesign(blogId: string): Promise<DesignRevisionRecord | null> { const [row] = await this.db.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.blogId, blogId), eq(schema.themeRevisions.active, true))); return row ? mapTheme(row) : null; }
  async completeDesignOperation(lease: OperationLease, config: BlogDesignSpecV1, artifactId: string, result: Record<string, unknown>): Promise<DesignRevisionRecord> {
    const validated = validateBlogDesignSpec(config);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(schema.operations).where(and(ownedLease(lease), inArray(schema.operations.type, ['generate_design', 'apply_design', 'activate_design']))).for('update');
      if (!row) throw new OperationLeaseLostError();
      const sourceArtifactId = row.payload.sourceArtifactId;
      const contentVersion = row.payload.contentVersion;
      const [blog] = await tx.select({ sourceArtifactId: schema.blogs.sourceArtifactId, draftArtifactId: schema.blogs.draftArtifactId, contentVersion: schema.blogs.contentVersion }).from(schema.blogs).where(and(eq(schema.blogs.id, row.blogId), eq(schema.blogs.userId, row.userId)));
      if (!blog || blog.sourceArtifactId !== sourceArtifactId || blog.contentVersion !== contentVersion) throw new Error('Source changed before design completion');
      const [artifact] = await tx.update(schema.artifacts).set({ state: 'ready', readyAt: new Date() }).where(and(eq(schema.artifacts.id, artifactId), eq(schema.artifacts.blogId, row.blogId), eq(schema.artifacts.kind, 'draft'), eq(schema.artifacts.state, 'uploading'))).returning();
      if (!artifact) throw new Error('Uploading draft artifact not found');
      let revision: typeof schema.themeRevisions.$inferSelect | undefined;
      if (row.type === 'activate_design') {
        const revisionId = row.payload.designRevisionId;
        if (typeof revisionId !== 'string') throw new Error('Design revision is required');
        [revision] = await tx.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.id, revisionId), eq(schema.themeRevisions.blogId, row.blogId)));
        if (!revision || JSON.stringify(parsePersistedDesign(revision.config)) !== JSON.stringify(validated)) throw new Error('Design revision changed');
      } else {
        const prompt = row.type === 'generate_design' && typeof row.payload.prompt === 'string' ? row.payload.prompt : null;
        [revision] = await tx.insert(schema.themeRevisions).values({ id: randomUUID(), blogId: row.blogId, config: validated, prompt, description: validated.description, source: row.type === 'generate_design' ? 'ai' : 'manual', active: false }).returning();
      }
      if (!revision) throw new Error('Design revision not found');
      await tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, row.blogId));
      await tx.update(schema.themeRevisions).set({ active: true }).where(eq(schema.themeRevisions.id, revision.id));
      await tx.update(schema.blogs).set({ draftArtifactId: artifact.id, draftDesignRevisionId: revision.id, updatedAt: new Date() }).where(eq(schema.blogs.id, row.blogId));
      if (blog.draftArtifactId) await tx.update(schema.artifacts).set({ state: 'cleanup_pending' }).where(eq(schema.artifacts.id, blog.draftArtifactId));
      await tx.update(schema.operations).set({ status: 'succeeded', result: { ...result, revisionId: revision.id }, errorMessage: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, lease.id));
      return mapTheme(revision);
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
    return this.createOperation(userId, blogId, 'sync', { ...parsed, excludedSlugs, previewPath: typeof payload.previewPath === 'string' ? payload.previewPath : '/' });
  }
  async createPublishOperation(userId: string, blogId: string, previewTokenHash: string, previewPath = '/'): Promise<OperationRecord> {
    const blog = await this.getBlog(blogId); if (!blog || blog.userId !== userId || !blog.sourceArtifactId || !blog.draftArtifactId || !blog.draftDesignRevisionId) throw new Error('Blog has no compiled draft. Sync the content first.');
    const theme = await this.getActiveDesign(blogId); if (!theme) throw new Error('Active design not found');
    const preview = await this.getPreviewSession(previewTokenHash); if (!preview || preview.userId !== userId || preview.blogId !== blogId) throw new Error('Preview session expired or invalid');
    if (preview.designConfig && JSON.stringify(preview.designConfig) !== JSON.stringify(theme.config)) throw new Error('Preview has unsaved design changes');
    if (blog.draftDesignRevisionId !== theme.id) throw new Error('Active design has not been compiled');
    const release = await this.getActiveRelease(blogId); if (release?.contentVersion === blog.contentVersion && release.themeRevisionId === theme.id) throw new Error('Nothing to publish');
    return this.createOperation(userId, blogId, 'publish', { contentVersion: blog.contentVersion, designRevisionId: theme.id, draftArtifactId: blog.draftArtifactId, previewPath });
  }
  async createDesignOperation(userId: string, blogId: string, prompt: string, baseDesign: unknown, limits: AiQuotaLimits, previewPath = '/'): Promise<OperationRecord> {
    const validatedBase = validateBlogDesignSpec(baseDesign); const at = limits.at ?? new Date(); const window = quotaWindow(at);
    return this.db.transaction(async (tx) => {
      const [active] = await tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))); if (active) throw new Error('Blog already has an active operation');
      const [blog] = await tx.select({ sourceArtifactId: schema.blogs.sourceArtifactId, contentVersion: schema.blogs.contentVersion }).from(schema.blogs).where(and(eq(schema.blogs.id, blogId), eq(schema.blogs.userId, userId)));
      if (!blog?.sourceArtifactId) throw new Error('Sync the content before changing the design');
      const op = newOperation(userId, blogId, 'generate_design', { prompt, baseDesign: validatedBase, sourceArtifactId: blog.sourceArtifactId, contentVersion: blog.contentVersion, previewPath });
      for (const item of [{ scope: 'user' as const, subject: userId, limit: limits.userDailyLimit }, { scope: 'global' as const, subject: '*', limit: limits.globalDailyLimit }]) {
        const [usage] = await tx.insert(schema.aiDailyUsage).values({ usageDate: window.date, scope: item.scope, subject: item.subject, count: 1 }).onConflictDoUpdate({ target: [schema.aiDailyUsage.usageDate, schema.aiDailyUsage.scope, schema.aiDailyUsage.subject], set: { count: sql`${schema.aiDailyUsage.count} + 1` } }).returning({ count: schema.aiDailyUsage.count });
        if (!usage || usage.count > item.limit) throw new AiQuotaExceededError(window.retryAfter);
      }
      const [row] = await tx.insert(schema.operations).values(op).returning(); await insertOutbox(tx, row.id);
      return mapOperation(row);
    });
  }
  async createApplyDesignOperation(userId: string, blogId: string, design: unknown, previewPath = '/'): Promise<OperationRecord> {
    const validated = validateBlogDesignSpec(design);
    const blog = await this.getBlog(blogId); if (!blog || blog.userId !== userId || !blog.sourceArtifactId) throw new Error('Sync the content before changing the design');
    return this.createOperation(userId, blogId, 'apply_design', { design: validated, sourceArtifactId: blog.sourceArtifactId, contentVersion: blog.contentVersion, previewPath });
  }
  async createActivateDesignOperation(userId: string, blogId: string, designRevisionId: string, previewPath = '/'): Promise<OperationRecord> {
    const blog = await this.getBlog(blogId); if (!blog || blog.userId !== userId || !blog.sourceArtifactId) throw new Error('Sync the content before changing the design');
    const revision = await this.getDesignRevision(designRevisionId, blogId); if (!revision) throw new Error('Design revision not found');
    return this.createOperation(userId, blogId, 'activate_design', { designRevisionId, sourceArtifactId: blog.sourceArtifactId, contentVersion: blog.contentVersion, previewPath });
  }
  async getOperation(id: string, userId?: string): Promise<OperationRecord | null> {
    const where = userId ? and(eq(schema.operations.id, id), eq(schema.operations.userId, userId)) : eq(schema.operations.id, id);
    const [row] = await this.db.select().from(schema.operations).where(where); return row ? mapOperation(row) : null;
  }
  async getActiveOperation(blogId: string, userId: string): Promise<OperationRecord | null> { const [row] = await this.db.select().from(schema.operations).where(and(eq(schema.operations.blogId, blogId), eq(schema.operations.userId, userId), inArray(schema.operations.status, ['queued', 'running']))); return row ? mapOperation(row) : null; }
  async claimOperation(id: string, leaseSeconds = OPERATION_LEASE_SECONDS): Promise<OperationRecord | null> {
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
  async updateOperationProgress(lease: OperationLease, progress: OperationProgress, message: string): Promise<void> {
    const [row] = await this.db.update(schema.operations).set({ result: { progress, progressMessage: message }, updatedAt: new Date() }).where(ownedLease(lease)).returning({ id: schema.operations.id });
    if (!row) throw new OperationLeaseLostError();
  }
  async failOperation(lease: OperationLease, message: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [operation] = await tx.select().from(schema.operations).where(ownedLease(lease)).for('update'); if (!operation) throw new OperationLeaseLostError();
      await tx.update(schema.operations).set({ status: 'failed', errorMessage: message, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, lease.id));
      if (operation.type === 'sync') {
        const [blog] = await tx.select({ draftArtifactId: schema.blogs.draftArtifactId }).from(schema.blogs).where(eq(schema.blogs.id, operation.blogId));
        await tx.update(schema.blogs).set({ state: blog?.draftArtifactId ? 'ready' : 'failed', lastError: message, updatedAt: new Date() }).where(eq(schema.blogs.id, operation.blogId));
      }
    });
  }
  /** Reopen stranded deliveries, with a fresh message identity to bypass queue deduplication. */
  async recoverExpiredOperations(limit = 100): Promise<number> {
    const now = new Date(); const queuedBefore = new Date(now.getTime() - OPERATION_LEASE_SECONDS * 1000);
    return this.db.transaction(async (tx) => {
      const rows = await tx.select({ operation: schema.operations, outbox: schema.operationOutbox }).from(schema.operations)
        .innerJoin(schema.operationOutbox, eq(schema.operationOutbox.operationId, schema.operations.id))
        .where(or(and(eq(schema.operations.status, 'running'), lt(schema.operations.leaseExpiresAt, now)), and(eq(schema.operations.status, 'queued'), lt(schema.operations.updatedAt, queuedBefore))))
        .limit(limit).for('update', { skipLocked: true });
      for (const { operation, outbox } of rows) {
        if (operation.attempts >= MAX_OPERATION_ATTEMPTS) {
          const message = 'Operation stopped after repeated worker interruptions.';
          await tx.update(schema.operations).set({ status: 'failed', errorMessage: message, leaseExpiresAt: null, updatedAt: now }).where(eq(schema.operations.id, operation.id));
          if (operation.type === 'sync') {
            const [blog] = await tx.select({ draftArtifactId: schema.blogs.draftArtifactId }).from(schema.blogs).where(eq(schema.blogs.id, operation.blogId));
            await tx.update(schema.blogs).set({ state: blog?.draftArtifactId ? 'ready' : 'failed', lastError: message, updatedAt: now }).where(eq(schema.blogs.id, operation.blogId));
          }
          await tx.update(schema.operationOutbox).set({ dispatchedAt: now }).where(eq(schema.operationOutbox.id, outbox.id));
        } else {
          await tx.update(schema.operations).set({ status: 'queued', lockedAt: null, leaseExpiresAt: null, updatedAt: now }).where(eq(schema.operations.id, operation.id));
          await tx.update(schema.operationOutbox).set({ dispatchedAt: null, payload: { ...operationMessage(operation.id) } }).where(eq(schema.operationOutbox.id, outbox.id));
        }
      }
      return rows.length;
    });
  }
  async listPendingOutbox(limit = 100): Promise<OutboxRecord[]> {
    const rows = await this.db.select().from(schema.operationOutbox).where(isNull(schema.operationOutbox.dispatchedAt)).orderBy(asc(schema.operationOutbox.createdAt)).limit(limit);
    return rows.map((row) => ({ id: row.id, operationId: row.operationId, message: row.payload as unknown as OperationMessage }));
  }
  async markOutboxDispatched(id: string, traceId: string): Promise<void> { await this.db.update(schema.operationOutbox).set({ dispatchedAt: new Date(), attempts: sql`${schema.operationOutbox.attempts} + 1` }).where(and(eq(schema.operationOutbox.id, id), sql`${schema.operationOutbox.payload}->>'traceId' = ${traceId}`)); }
  async noteOutboxAttempt(id: string): Promise<void> { await this.db.update(schema.operationOutbox).set({ attempts: sql`${schema.operationOutbox.attempts} + 1` }).where(eq(schema.operationOutbox.id, id)); }

  async completePublishOperation(lease: OperationLease, artifactId: string, snapshot: ReleaseSnapshot, result: Record<string, unknown>): Promise<PublishedReleaseRecord> {
    const validated = releaseSnapshotSchema.parse(snapshot);
    return this.db.transaction(async (tx) => {
      const [operation] = await tx.select().from(schema.operations).where(and(ownedLease(lease), eq(schema.operations.type, 'publish'))).for('update'); if (!operation) throw new OperationLeaseLostError();
      const contentVersion = operation.payload.contentVersion; const themeRevisionId = operation.payload.designRevisionId; const draftArtifactId = operation.payload.draftArtifactId;
      if (!Number.isInteger(contentVersion) || typeof themeRevisionId !== 'string' || typeof draftArtifactId !== 'string') throw new Error('Publish snapshot is invalid');
      const [blog] = await tx.select({ contentVersion: schema.blogs.contentVersion, draftArtifactId: schema.blogs.draftArtifactId, draftDesignRevisionId: schema.blogs.draftDesignRevisionId }).from(schema.blogs).where(and(eq(schema.blogs.id, operation.blogId), eq(schema.blogs.userId, operation.userId)));
      if (!blog || blog.contentVersion !== contentVersion || blog.draftArtifactId !== draftArtifactId || blog.draftDesignRevisionId !== themeRevisionId) throw new Error('Draft changed before publishing');
      const [artifact] = await tx.update(schema.artifacts).set({ state: 'ready', readyAt: new Date() }).where(and(eq(schema.artifacts.id, artifactId), eq(schema.artifacts.blogId, operation.blogId), eq(schema.artifacts.state, 'uploading'))).returning(); if (!artifact) throw new Error('Uploading artifact not found');
      await tx.update(schema.publishedReleases).set({ active: false }).where(eq(schema.publishedReleases.blogId, operation.blogId));
      const [release] = await tx.insert(schema.publishedReleases).values({ id: randomUUID(), blogId: operation.blogId, themeRevisionId, contentVersion, snapshot: validated, artifactId, active: true }).returning();
      await tx.update(schema.operations).set({ status: 'succeeded', result, errorMessage: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.operations.id, lease.id));
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

  async pruneTransientData(at = new Date()): Promise<TransientCleanupResult> {
    const operationCutoff = new Date(at.getTime() - 30 * 24 * 60 * 60_000);
    const usageCutoff = operationCutoff.toISOString().slice(0, 10);
    const rateLimitCutoff = Math.floor(at.getTime() / 1000) - 24 * 60 * 60;
    return this.db.transaction(async (tx) => {
      const previewSessions = await tx.delete(schema.previewSessions).where(lte(schema.previewSessions.expiresAt, at)).returning({ id: schema.previewSessions.tokenHash });
      const operations = await tx.delete(schema.operations).where(and(inArray(schema.operations.status, ['succeeded', 'failed']), lt(schema.operations.updatedAt, operationCutoff))).returning({ id: schema.operations.id });
      const aiUsage = await tx.delete(schema.aiDailyUsage).where(lt(schema.aiDailyUsage.usageDate, usageCutoff)).returning({ date: schema.aiDailyUsage.usageDate });
      const rateLimits = await tx.delete(schema.rateLimit).where(lt(schema.rateLimit.lastRequest, rateLimitCutoff)).returning({ id: schema.rateLimit.id });
      return { previewSessions: previewSessions.length, operations: operations.length, aiUsage: aiUsage.length, rateLimits: rateLimits.length };
    });
  }

  async beginBlogDeletion(userId: string): Promise<BlogDeletionPlan | null> {
    return this.db.transaction(async (tx) => {
      const [blog] = await tx.select().from(schema.blogs).where(eq(schema.blogs.userId, userId)).for('update');
      if (!blog) return null;
      const [active] = await tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blog.id), inArray(schema.operations.status, ['queued', 'running'])));
      if (active) throw new Error('Blog already has an active operation');
      await tx.delete(schema.publishedReleases).where(eq(schema.publishedReleases.blogId, blog.id));
      await tx.update(schema.artifacts).set({ state: 'cleanup_pending' }).where(eq(schema.artifacts.blogId, blog.id));
      await tx.update(schema.blogs).set({ state: 'deleting', lastError: null, updatedAt: new Date() }).where(eq(schema.blogs.id, blog.id));
      const artifacts = await tx.select().from(schema.artifacts).where(eq(schema.artifacts.blogId, blog.id));
      return { blogId: blog.id, artifacts: artifacts.map(mapArtifact) };
    });
  }

  async noteBlogDeletionFailure(userId: string, blogId: string): Promise<void> {
    await this.db.update(schema.blogs).set({ state: 'deleting', lastError: 'Deletion could not finish. Retry to remove the remaining data.', updatedAt: new Date() })
      .where(and(eq(schema.blogs.id, blogId), eq(schema.blogs.userId, userId)));
  }

  async finishBlogDeletion(userId: string, blogId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [blog] = await tx.select({ id: schema.blogs.id, state: schema.blogs.state }).from(schema.blogs).where(and(eq(schema.blogs.id, blogId), eq(schema.blogs.userId, userId))).for('update');
      if (!blog) return;
      if (blog.state !== 'deleting') throw new Error('Blog deletion has not started');
      const [artifact] = await tx.select({ id: schema.artifacts.id }).from(schema.artifacts).where(eq(schema.artifacts.blogId, blogId)).limit(1);
      if (artifact) throw new Error('Blog artifacts remain');
      await tx.delete(schema.blogs).where(eq(schema.blogs.id, blogId));
    });
  }

  async finishAccountDeletion(userId: string, blogId: string | null, rateLimitKeys: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (blogId) {
        const [blog] = await tx.select({ state: schema.blogs.state }).from(schema.blogs).where(and(eq(schema.blogs.id, blogId), eq(schema.blogs.userId, userId))).for('update');
        if (!blog) throw new Error('Blog not found');
        if (blog.state !== 'deleting') throw new Error('Blog deletion has not started');
        const [artifact] = await tx.select({ id: schema.artifacts.id }).from(schema.artifacts).where(eq(schema.artifacts.blogId, blogId)).limit(1);
        if (artifact) throw new Error('Blog artifacts remain');
      }
      await tx.delete(schema.aiDailyUsage).where(and(eq(schema.aiDailyUsage.scope, 'user'), eq(schema.aiDailyUsage.subject, userId)));
      if (rateLimitKeys.length > 0) await tx.delete(schema.rateLimit).where(inArray(schema.rateLimit.key, rateLimitKeys));
      await tx.delete(schema.user).where(eq(schema.user.id, userId));
    });
  }

  async createPreviewSession(tokenHash: string, userId: string, blogId: string, expiresAt: string, designConfig: BlogDesignSpecV1): Promise<void> {
    const validated = validateBlogDesignSpec(designConfig); await this.db.transaction(async (tx) => { await tx.delete(schema.previewSessions).where(lt(schema.previewSessions.expiresAt, new Date())); await tx.insert(schema.previewSessions).values({ tokenHash, userId, blogId, themeConfig: validated, expiresAt: new Date(expiresAt) }); });
  }
  async getPreviewSession(tokenHash: string): Promise<PreviewSessionRecord | null> { const [row] = await this.db.select().from(schema.previewSessions).where(and(eq(schema.previewSessions.tokenHash, tokenHash), gt(schema.previewSessions.expiresAt, new Date()))); return row ? mapPreview(row) : null; }
  async updatePreviewDesign(tokenHash: string, userId: string, blogId: string, config: BlogDesignSpecV1): Promise<BlogDesignSpecV1> {
    const validated = validateBlogDesignSpec(config); const [row] = await this.db.update(schema.previewSessions).set({ themeConfig: validated }).where(and(eq(schema.previewSessions.tokenHash, tokenHash), eq(schema.previewSessions.userId, userId), eq(schema.previewSessions.blogId, blogId), gt(schema.previewSessions.expiresAt, new Date()))).returning();
    if (!row) throw new Error('Preview session expired or invalid'); return validated;
  }
}
