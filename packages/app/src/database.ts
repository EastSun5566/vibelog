import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3/driver';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { ThemeConfig } from '@vibelog/core';
import { DEFAULT_THEME, validateThemeConfig } from '@vibelog/core';
import { z } from 'zod';
import { drizzleNodeSqlite } from './node-sqlite-drizzle.js';
import * as schema from './schema.js';

export type BlogState = 'syncing' | 'ready' | 'failed';
export type OperationType = 'sync' | 'generate_theme' | 'publish';
export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ThemeRevisionSource = 'system' | 'ai' | 'manual';
export interface SyncedPostSummary { title: string; slug: string; publishedAt: string }
export interface BlogRecord { id: string; userId: string; username: string; hackmdUsername: string; title: string | null; description: string | null; author: string | null; state: BlogState; lastError: string | null; draftArtifact: string | null; contentVersion: number; contentManifest: SyncedPostSummary[] | null; lastSyncedAt: string | null; createdAt: string; updatedAt: string }
export interface ThemeRevisionRecord { id: string; blogId: string; config: ThemeConfig; prompt: string | null; description: string; source: ThemeRevisionSource; active: boolean; createdAt: string }
export interface OperationRecord { id: string; userId: string; blogId: string; type: OperationType; status: OperationStatus; payload: Record<string, unknown>; result: Record<string, unknown> | null; errorMessage: string | null; attempts: number; createdAt: string; updatedAt: string }
export interface PublishedReleaseRecord { id: string; blogId: string; themeRevisionId: string; contentVersion: number; artifact: string; active: boolean; createdAt: string }
export interface PreviewSessionRecord { tokenHash: string; userId: string; blogId: string; themeConfig: ThemeConfig | null; expiresAt: string }
export interface AiQuotaLimits { userDailyLimit: number; globalDailyLimit: number; at?: Date }
export class AiQuotaExceededError extends Error { constructor(readonly retryAfter: number) { super('AI daily quota exceeded'); this.name = 'AiQuotaExceededError'; } }

const now = () => new Date().toISOString();
const parseObject = (value: string) => JSON.parse(value) as Record<string, unknown>;
const syncedPostSummarySchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  publishedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid published date'),
});
const contentManifestSchema = z.array(syncedPostSummarySchema);
const mapBlog = (row: typeof schema.blogs.$inferSelect): BlogRecord => ({ ...row, contentManifest: row.contentManifest ? contentManifestSchema.parse(JSON.parse(row.contentManifest)) : null });
const mapTheme = (row: typeof schema.themeRevisions.$inferSelect): ThemeRevisionRecord => ({ ...row, config: validateThemeConfig(JSON.parse(row.config)) });
const mapOperation = (row: typeof schema.operations.$inferSelect): OperationRecord => ({ ...row, payload: parseObject(row.payload), result: row.result ? parseObject(row.result) : null });
const mapPreview = (row: typeof schema.previewSessions.$inferSelect): PreviewSessionRecord => ({ ...row, themeConfig: row.themeConfig ? validateThemeConfig(JSON.parse(row.themeConfig)) : null });
function quotaWindow(at: Date): { date: string; retryAfter: number } { const next = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1); return { date: at.toISOString().slice(0, 10), retryAfter: Math.max(1, Math.ceil((next - at.getTime()) / 1000)) }; }

function refuseLegacyDatabase(connection: DatabaseSync): void {
  const tables = connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name));
  if (!tables.includes('app_meta') && tables.some((name) => ['projects', 'jobs', 'credentials', 'deployments'].includes(name))) {
    throw new Error('This volume contains a pre-0.5 VibeLog database. Delete the SQLite volume before starting VibeLog 0.5.');
  }
}
function migrateDatabase(db: BetterSQLite3Database<typeof schema>, migrationsFolder: string): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  db.run(sql.raw('CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at INTEGER NOT NULL)'));
  db.run(sql.raw('BEGIN IMMEDIATE'));
  try {
    const last = db.values<[number, string, number]>(sql.raw('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1'))[0];
    for (const migration of migrations) {
      if (last && last[2] >= migration.folderMillis) continue;
      for (const statement of migration.sql) db.run(sql.raw(statement));
      db.run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`);
    }
    db.run(sql.raw('COMMIT'));
  } catch (error) { db.run(sql.raw('ROLLBACK')); throw error; }
}

export class AppDatabase {
  readonly connection: DatabaseSync;
  readonly db: BetterSQLite3Database<typeof schema>;
  constructor(dataRoot: string, databasePath = join(dataRoot, 'vibelog.sqlite')) {
    mkdirSync(dataRoot, { recursive: true });
    this.connection = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
    this.connection.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    refuseLegacyDatabase(this.connection);
    this.db = drizzleNodeSqlite(this.connection, schema);
    migrateDatabase(this.db, fileURLToPath(new URL('./drizzle', import.meta.url)));
    this.db.insert(schema.appMeta).values({ key: 'schema_version', value: '0.5' }).onConflictDoNothing().run();
  }
  close(): void { this.connection.close(); }

  consumeInviteAttempt(ip: string, at = new Date()): boolean {
    const key = `invite:${ip}`;
    const timestamp = Math.floor(at.getTime() / 1000);
    return this.db.transaction((tx) => {
      const row = tx.select().from(schema.rateLimit).where(eq(schema.rateLimit.key, key)).get();
      const expired = !row || timestamp - row.lastRequest >= 3600;
      const count = expired ? 1 : row.count + 1;
      if (!row) tx.insert(schema.rateLimit).values({ id: randomUUID(), key, count, lastRequest: timestamp }).run();
      else tx.update(schema.rateLimit).set({ count, lastRequest: expired ? timestamp : row.lastRequest }).where(eq(schema.rateLimit.key, key)).run();
      return count <= 3;
    }, { behavior: 'immediate' });
  }

  createBlog(userId: string, username: string, hackmdUsername: string): { blog: BlogRecord; operation: OperationRecord } {
    const timestamp = now();
    const blog: BlogRecord = { id: randomUUID(), userId, username, hackmdUsername, title: null, description: null, author: null, state: 'syncing', lastError: null, draftArtifact: null, contentVersion: 0, contentManifest: null, lastSyncedAt: null, createdAt: timestamp, updatedAt: timestamp };
    const operation = this.newOperation(userId, blog.id, 'sync', { intent: 'content' });
    return this.db.transaction((tx) => {
      tx.insert(schema.blogs).values({ ...blog, contentManifest: null }).run();
      tx.insert(schema.themeRevisions).values({ id: randomUUID(), blogId: blog.id, config: JSON.stringify(DEFAULT_THEME), prompt: null, description: DEFAULT_THEME.description, source: 'system', active: true, createdAt: timestamp }).run();
      tx.insert(schema.operations).values({ ...operation, payload: JSON.stringify(operation.payload), result: null }).run();
      return { blog, operation };
    }, { behavior: 'immediate' });
  }
  getBlogForUser(userId: string): BlogRecord | null { const row = this.db.select().from(schema.blogs).where(eq(schema.blogs.userId, userId)).get(); return row ? mapBlog(row) : null; }
  getBlog(id: string): BlogRecord | null { const row = this.db.select().from(schema.blogs).where(eq(schema.blogs.id, id)).get(); return row ? mapBlog(row) : null; }
  getBlogByUsername(username: string): BlogRecord | null { const row = this.db.select().from(schema.blogs).where(eq(schema.blogs.username, username)).get(); return row ? mapBlog(row) : null; }
  retryInitialSync(userId: string, hackmdUsername: string): OperationRecord {
    return this.db.transaction((tx) => {
      const blog = tx.select().from(schema.blogs).where(eq(schema.blogs.userId, userId)).get();
      if (!blog) throw new Error('Blog not found');
      if (blog.draftArtifact) throw new Error('Blog already has synced content');
      const active = tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blog.id), inArray(schema.operations.status, ['queued', 'running']))).get();
      if (active) throw new Error('Blog already has an active operation');
      const operation = this.newOperation(userId, blog.id, 'sync', { intent: 'content' });
      tx.update(schema.blogs).set({ hackmdUsername, state: 'syncing', lastError: null, updatedAt: now() }).where(eq(schema.blogs.id, blog.id)).run();
      tx.insert(schema.operations).values({ ...operation, payload: JSON.stringify(operation.payload), result: null }).run();
      return operation;
    }, { behavior: 'immediate' });
  }
  completeSync(blogId: string, metadata: { title: string; description: string; author: string; draftArtifact: string; contentManifest?: SyncedPostSummary[]; lastSyncedAt?: string }): void {
    const timestamp = metadata.lastSyncedAt ?? now();
    const contentManifest = contentManifestSchema.parse(metadata.contentManifest ?? [])
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || left.slug.localeCompare(right.slug));
    this.db.transaction((tx) => {
      tx.update(schema.blogs).set({ ...metadata, contentManifest: JSON.stringify(contentManifest), lastSyncedAt: timestamp, contentVersion: sql`${schema.blogs.contentVersion} + 1`, state: 'ready', lastError: null, updatedAt: timestamp }).where(eq(schema.blogs.id, blogId)).run();
    }, { behavior: 'immediate' });
  }
  failSync(blogId: string, message: string): void { const blog = this.getBlog(blogId); this.db.update(schema.blogs).set({ state: blog?.draftArtifact ? 'ready' : 'failed', lastError: message, updatedAt: now() }).where(eq(schema.blogs.id, blogId)).run(); }

  listThemes(blogId: string): ThemeRevisionRecord[] { return this.db.select().from(schema.themeRevisions).where(eq(schema.themeRevisions.blogId, blogId)).orderBy(desc(schema.themeRevisions.createdAt)).all().map(mapTheme); }
  getTheme(id: string, blogId: string): ThemeRevisionRecord | null { const row = this.db.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.id, id), eq(schema.themeRevisions.blogId, blogId))).get(); return row ? mapTheme(row) : null; }
  getActiveTheme(blogId: string): ThemeRevisionRecord | null { const row = this.db.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.blogId, blogId), eq(schema.themeRevisions.active, true))).get(); return row ? mapTheme(row) : null; }
  createTheme(blogId: string, config: ThemeConfig, prompt: string): ThemeRevisionRecord {
    const validated = validateThemeConfig(config);
    const record: ThemeRevisionRecord = { id: randomUUID(), blogId, config: validated, prompt, description: validated.description, source: 'ai', active: true, createdAt: now() };
    return this.db.transaction((tx) => { tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, blogId)).run(); tx.insert(schema.themeRevisions).values({ ...record, config: JSON.stringify(validated) }).run(); return record; }, { behavior: 'immediate' });
  }
  createManualTheme(userId: string, blogId: string, config: ThemeConfig): ThemeRevisionRecord {
    const validated = validateThemeConfig(config);
    const record: ThemeRevisionRecord = { id: randomUUID(), blogId, config: validated, prompt: null, description: validated.description, source: 'manual', active: true, createdAt: now() };
    return this.db.transaction((tx) => {
      const blog = tx.select({ id: schema.blogs.id }).from(schema.blogs).where(and(eq(schema.blogs.id, blogId), eq(schema.blogs.userId, userId))).get();
      if (!blog) throw new Error('Blog not found');
      const activeOperation = tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))).get();
      if (activeOperation) throw new Error('Blog already has an active operation');
      tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, blogId)).run();
      tx.insert(schema.themeRevisions).values({ ...record, config: JSON.stringify(validated) }).run();
      return record;
    }, { behavior: 'immediate' });
  }
  activateTheme(id: string, blogId: string): void { this.db.transaction((tx) => { const activeOperation = tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))).get(); if (activeOperation) throw new Error('Blog already has an active operation'); const found = tx.select({ id: schema.themeRevisions.id }).from(schema.themeRevisions).where(and(eq(schema.themeRevisions.id, id), eq(schema.themeRevisions.blogId, blogId))).get(); if (!found) throw new Error('Theme revision not found'); tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, blogId)).run(); tx.update(schema.themeRevisions).set({ active: true }).where(eq(schema.themeRevisions.id, id)).run(); }, { behavior: 'immediate' }); }

  private newOperation(userId: string, blogId: string, type: OperationType, payload: Record<string, unknown>): OperationRecord { const timestamp = now(); return { id: randomUUID(), userId, blogId, type, status: 'queued', payload, result: null, errorMessage: null, attempts: 0, createdAt: timestamp, updatedAt: timestamp }; }
  createSyncOperation(userId: string, blogId: string, payload: Record<string, unknown>): OperationRecord {
    return this.db.transaction((tx) => {
      const blog = tx.select().from(schema.blogs).where(and(eq(schema.blogs.id, blogId), eq(schema.blogs.userId, userId))).get();
      if (!blog) throw new Error('Blog not found');
      if (payload.intent === 'identity') {
        const site = payload.site as { title?: unknown; description?: unknown } | undefined;
        if (site?.title === blog.title && site.description === (blog.description ?? '')) throw new Error('Nothing to update');
      }
      const active = tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))).get();
      if (active) throw new Error('Blog already has an active operation');
      const operation = this.newOperation(userId, blogId, 'sync', payload);
      tx.insert(schema.operations).values({ ...operation, payload: JSON.stringify(payload), result: null }).run();
      return operation;
    }, { behavior: 'immediate' });
  }
  createPublishOperation(userId: string, blogId: string, previewTokenHash: string): OperationRecord {
    return this.db.transaction((tx) => {
      const blog = tx.select().from(schema.blogs).where(and(eq(schema.blogs.id, blogId), eq(schema.blogs.userId, userId))).get();
      if (!blog?.draftArtifact) throw new Error('Blog has no synced content');
      const theme = tx.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.blogId, blogId), eq(schema.themeRevisions.active, true))).get();
      if (!theme) throw new Error('Active theme not found');
      const preview = tx.select().from(schema.previewSessions).where(and(eq(schema.previewSessions.tokenHash, previewTokenHash), eq(schema.previewSessions.userId, userId), eq(schema.previewSessions.blogId, blogId), gt(schema.previewSessions.expiresAt, now()))).get();
      if (!preview) throw new Error('Preview session expired or invalid');
      if (preview.themeConfig && JSON.stringify(validateThemeConfig(JSON.parse(preview.themeConfig))) !== JSON.stringify(validateThemeConfig(JSON.parse(theme.config)))) throw new Error('Preview has unsaved theme changes');
      const release = tx.select().from(schema.publishedReleases).where(and(eq(schema.publishedReleases.blogId, blogId), eq(schema.publishedReleases.active, true))).get();
      if (release?.contentVersion === blog.contentVersion && release.themeRevisionId === theme.id) throw new Error('Nothing to publish');
      const active = tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))).get();
      if (active) throw new Error('Blog already has an active operation');
      const operation = this.newOperation(userId, blogId, 'publish', { contentVersion: blog.contentVersion, themeRevisionId: theme.id });
      tx.insert(schema.operations).values({ ...operation, payload: JSON.stringify(operation.payload), result: null }).run();
      return operation;
    }, { behavior: 'immediate' });
  }
  createThemeOperation(userId: string, blogId: string, prompt: string, baseTheme: unknown, limits: AiQuotaLimits): OperationRecord {
    const validatedBase = validateThemeConfig(baseTheme);
    const at = limits.at ?? new Date(); const window = quotaWindow(at); const op = this.newOperation(userId, blogId, 'generate_theme', { prompt, baseTheme: validatedBase });
    return this.db.transaction((tx) => {
      const active = tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))).get();
      if (active) throw new Error('Blog already has an active operation');
      const usage = tx.select().from(schema.aiDailyUsage).where(and(eq(schema.aiDailyUsage.usageDate, window.date), sql`(${schema.aiDailyUsage.scope} = 'global' or ${schema.aiDailyUsage.subject} = ${userId})`)).all();
      if ((usage.find((item) => item.scope === 'user')?.count ?? 0) >= limits.userDailyLimit || (usage.find((item) => item.scope === 'global')?.count ?? 0) >= limits.globalDailyLimit) throw new AiQuotaExceededError(window.retryAfter);
      tx.insert(schema.operations).values({ ...op, payload: JSON.stringify(op.payload), result: null }).run();
      for (const item of [{ scope: 'user' as const, subject: userId }, { scope: 'global' as const, subject: '*' }]) tx.insert(schema.aiDailyUsage).values({ usageDate: window.date, ...item, count: 1 }).onConflictDoUpdate({ target: [schema.aiDailyUsage.usageDate, schema.aiDailyUsage.scope, schema.aiDailyUsage.subject], set: { count: sql`${schema.aiDailyUsage.count} + 1` } }).run();
      return op;
    }, { behavior: 'immediate' });
  }
  getOperation(id: string, userId: string): OperationRecord | null { const row = this.db.select().from(schema.operations).where(and(eq(schema.operations.id, id), eq(schema.operations.userId, userId))).get(); return row ? mapOperation(row) : null; }
  getActiveOperation(blogId: string, userId: string): OperationRecord | null { const row = this.db.select().from(schema.operations).where(and(eq(schema.operations.blogId, blogId), eq(schema.operations.userId, userId), inArray(schema.operations.status, ['queued', 'running']))).get(); return row ? mapOperation(row) : null; }
  claimNextOperation(): OperationRecord | null { return this.db.transaction((tx) => { const row = tx.select().from(schema.operations).where(eq(schema.operations.status, 'queued')).orderBy(asc(schema.operations.createdAt)).limit(1).get(); if (!row) return null; const updatedAt = now(); tx.update(schema.operations).set({ status: 'running', attempts: row.attempts + 1, updatedAt }).where(and(eq(schema.operations.id, row.id), eq(schema.operations.status, 'queued'))).run(); return mapOperation({ ...row, status: 'running', attempts: row.attempts + 1, updatedAt }); }, { behavior: 'immediate' }); }
  recoverOperations(): void { this.db.update(schema.operations).set({ status: 'queued', updatedAt: now() }).where(eq(schema.operations.status, 'running')).run(); }
  completeOperation(id: string, result: Record<string, unknown> = {}): void { this.db.update(schema.operations).set({ status: 'succeeded', result: JSON.stringify(result), errorMessage: null, updatedAt: now() }).where(eq(schema.operations.id, id)).run(); }
  failOperation(id: string, message: string): void { this.db.update(schema.operations).set({ status: 'failed', errorMessage: message, updatedAt: now() }).where(eq(schema.operations.id, id)).run(); }

  activateRelease(blogId: string, themeRevisionId: string, contentVersion: number, artifact: string): PublishedReleaseRecord { const record: PublishedReleaseRecord = { id: randomUUID(), blogId, themeRevisionId, contentVersion, artifact, active: true, createdAt: now() }; return this.db.transaction((tx) => { tx.update(schema.publishedReleases).set({ active: false }).where(eq(schema.publishedReleases.blogId, blogId)).run(); tx.insert(schema.publishedReleases).values(record).run(); return record; }, { behavior: 'immediate' }); }
  getActiveRelease(blogId: string): PublishedReleaseRecord | null { return this.db.select().from(schema.publishedReleases).where(and(eq(schema.publishedReleases.blogId, blogId), eq(schema.publishedReleases.active, true))).get() ?? null; }
  listReleases(blogId: string): PublishedReleaseRecord[] { return this.db.select().from(schema.publishedReleases).where(eq(schema.publishedReleases.blogId, blogId)).orderBy(desc(schema.publishedReleases.createdAt)).all(); }
  getRelease(id: string, blogId: string): PublishedReleaseRecord | null { return this.db.select().from(schema.publishedReleases).where(and(eq(schema.publishedReleases.id, id), eq(schema.publishedReleases.blogId, blogId))).get() ?? null; }
  activateExistingRelease(id: string, blogId: string): PublishedReleaseRecord {
    return this.db.transaction((tx) => {
      const release = tx.select().from(schema.publishedReleases).where(and(eq(schema.publishedReleases.id, id), eq(schema.publishedReleases.blogId, blogId))).get();
      if (!release) throw new Error('Release not found');
      if (release.active) throw new Error('Release already active');
      const activeOperation = tx.select({ id: schema.operations.id }).from(schema.operations).where(and(eq(schema.operations.blogId, blogId), inArray(schema.operations.status, ['queued', 'running']))).get();
      if (activeOperation) throw new Error('Blog already has an active operation');
      tx.update(schema.publishedReleases).set({ active: false }).where(eq(schema.publishedReleases.blogId, blogId)).run();
      tx.update(schema.publishedReleases).set({ active: true }).where(and(eq(schema.publishedReleases.id, id), eq(schema.publishedReleases.blogId, blogId))).run();
      return { ...release, active: true };
    }, { behavior: 'immediate' });
  }
  createPreviewSession(tokenHash: string, userId: string, blogId: string, expiresAt: string, themeConfig: ThemeConfig): void { const validated = validateThemeConfig(themeConfig); this.db.transaction((tx) => { tx.delete(schema.previewSessions).where(sql`${schema.previewSessions.expiresAt} <= ${now()}`).run(); tx.insert(schema.previewSessions).values({ tokenHash, userId, blogId, themeConfig: JSON.stringify(validated), expiresAt, createdAt: now() }).run(); }, { behavior: 'immediate' }); }
  getPreviewSession(tokenHash: string): PreviewSessionRecord | null { const row = this.db.select().from(schema.previewSessions).where(and(eq(schema.previewSessions.tokenHash, tokenHash), gt(schema.previewSessions.expiresAt, now()))).get(); return row ? mapPreview(row) : null; }
  updatePreviewTheme(tokenHash: string, userId: string, blogId: string, config: ThemeConfig): ThemeConfig {
    const validated = validateThemeConfig(config);
    return this.db.transaction((tx) => {
      const preview = tx.select({ tokenHash: schema.previewSessions.tokenHash }).from(schema.previewSessions).where(and(eq(schema.previewSessions.tokenHash, tokenHash), eq(schema.previewSessions.userId, userId), eq(schema.previewSessions.blogId, blogId), gt(schema.previewSessions.expiresAt, now()))).get();
      if (!preview) throw new Error('Preview session expired or invalid');
      tx.update(schema.previewSessions).set({ themeConfig: JSON.stringify(validated) }).where(eq(schema.previewSessions.tokenHash, tokenHash)).run();
      return validated;
    }, { behavior: 'immediate' });
  }
}
