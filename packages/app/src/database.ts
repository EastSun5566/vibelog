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
import { drizzleNodeSqlite } from './node-sqlite-drizzle.js';
import * as schema from './schema.js';

export type BlogState = 'syncing' | 'ready' | 'failed';
export type OperationType = 'sync' | 'generate_theme' | 'publish';
export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export interface BlogRecord { id: string; userId: string; username: string; hackmdUsername: string; title: string | null; description: string | null; author: string | null; state: BlogState; lastError: string | null; draftArtifact: string | null; createdAt: string; updatedAt: string }
export interface ThemeRevisionRecord { id: string; blogId: string; config: ThemeConfig; prompt: string | null; description: string; active: boolean; createdAt: string }
export interface OperationRecord { id: string; userId: string; blogId: string; type: OperationType; status: OperationStatus; payload: Record<string, unknown>; result: Record<string, unknown> | null; errorMessage: string | null; attempts: number; createdAt: string; updatedAt: string }
export interface PublishedReleaseRecord { id: string; blogId: string; themeRevisionId: string; artifact: string; active: boolean; createdAt: string }
export interface AiQuotaLimits { userDailyLimit: number; globalDailyLimit: number; at?: Date }
export class AiQuotaExceededError extends Error { constructor(readonly retryAfter: number) { super('AI daily quota exceeded'); this.name = 'AiQuotaExceededError'; } }

const now = () => new Date().toISOString();
const parseObject = (value: string) => JSON.parse(value) as Record<string, unknown>;
const mapBlog = (row: typeof schema.blogs.$inferSelect): BlogRecord => row;
const mapTheme = (row: typeof schema.themeRevisions.$inferSelect): ThemeRevisionRecord => ({ ...row, config: validateThemeConfig(JSON.parse(row.config)) });
const mapOperation = (row: typeof schema.operations.$inferSelect): OperationRecord => ({ ...row, payload: parseObject(row.payload), result: row.result ? parseObject(row.result) : null });
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
    const blog: BlogRecord = { id: randomUUID(), userId, username, hackmdUsername, title: null, description: null, author: null, state: 'syncing', lastError: null, draftArtifact: null, createdAt: timestamp, updatedAt: timestamp };
    const operation = this.newOperation(userId, blog.id, 'sync', {});
    return this.db.transaction((tx) => {
      tx.insert(schema.blogs).values(blog).run();
      tx.insert(schema.themeRevisions).values({ id: randomUUID(), blogId: blog.id, config: JSON.stringify(DEFAULT_THEME), prompt: null, description: DEFAULT_THEME.description, active: true, createdAt: timestamp }).run();
      tx.insert(schema.operations).values({ ...operation, payload: '{}', result: null }).run();
      return { blog, operation };
    }, { behavior: 'immediate' });
  }
  getBlogForUser(userId: string): BlogRecord | null { const row = this.db.select().from(schema.blogs).where(eq(schema.blogs.userId, userId)).get(); return row ? mapBlog(row) : null; }
  getBlog(id: string): BlogRecord | null { const row = this.db.select().from(schema.blogs).where(eq(schema.blogs.id, id)).get(); return row ? mapBlog(row) : null; }
  getBlogByUsername(username: string): BlogRecord | null { const row = this.db.select().from(schema.blogs).where(eq(schema.blogs.username, username)).get(); return row ? mapBlog(row) : null; }
  completeSync(blogId: string, metadata: { title: string; description: string; author: string; draftArtifact: string }): void { this.db.update(schema.blogs).set({ ...metadata, state: 'ready', lastError: null, updatedAt: now() }).where(eq(schema.blogs.id, blogId)).run(); }
  failSync(blogId: string, message: string): void { const blog = this.getBlog(blogId); this.db.update(schema.blogs).set({ state: blog?.draftArtifact ? 'ready' : 'failed', lastError: message, updatedAt: now() }).where(eq(schema.blogs.id, blogId)).run(); }

  listThemes(blogId: string): ThemeRevisionRecord[] { return this.db.select().from(schema.themeRevisions).where(eq(schema.themeRevisions.blogId, blogId)).orderBy(desc(schema.themeRevisions.createdAt)).all().map(mapTheme); }
  getTheme(id: string, blogId: string): ThemeRevisionRecord | null { const row = this.db.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.id, id), eq(schema.themeRevisions.blogId, blogId))).get(); return row ? mapTheme(row) : null; }
  getActiveTheme(blogId: string): ThemeRevisionRecord | null { const row = this.db.select().from(schema.themeRevisions).where(and(eq(schema.themeRevisions.blogId, blogId), eq(schema.themeRevisions.active, true))).get(); return row ? mapTheme(row) : null; }
  createTheme(blogId: string, config: ThemeConfig, prompt: string): ThemeRevisionRecord {
    const validated = validateThemeConfig(config);
    const record: ThemeRevisionRecord = { id: randomUUID(), blogId, config: validated, prompt, description: validated.description, active: true, createdAt: now() };
    return this.db.transaction((tx) => { tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, blogId)).run(); tx.insert(schema.themeRevisions).values({ ...record, config: JSON.stringify(validated) }).run(); return record; }, { behavior: 'immediate' });
  }
  activateTheme(id: string, blogId: string): void { this.db.transaction((tx) => { const found = tx.select({ id: schema.themeRevisions.id }).from(schema.themeRevisions).where(and(eq(schema.themeRevisions.id, id), eq(schema.themeRevisions.blogId, blogId))).get(); if (!found) throw new Error('Theme revision not found'); tx.update(schema.themeRevisions).set({ active: false }).where(eq(schema.themeRevisions.blogId, blogId)).run(); tx.update(schema.themeRevisions).set({ active: true }).where(eq(schema.themeRevisions.id, id)).run(); }, { behavior: 'immediate' }); }

  private newOperation(userId: string, blogId: string, type: OperationType, payload: Record<string, unknown>): OperationRecord { const timestamp = now(); return { id: randomUUID(), userId, blogId, type, status: 'queued', payload, result: null, errorMessage: null, attempts: 0, createdAt: timestamp, updatedAt: timestamp }; }
  createOperation(userId: string, blogId: string, type: Exclude<OperationType, 'generate_theme'>, payload: Record<string, unknown> = {}): OperationRecord { const op = this.newOperation(userId, blogId, type, payload); this.db.insert(schema.operations).values({ ...op, payload: JSON.stringify(payload), result: null }).run(); return op; }
  createThemeOperation(userId: string, blogId: string, prompt: string, limits: AiQuotaLimits): OperationRecord {
    const at = limits.at ?? new Date(); const window = quotaWindow(at); const op = this.newOperation(userId, blogId, 'generate_theme', { prompt });
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
  claimNextOperation(): OperationRecord | null { return this.db.transaction((tx) => { const row = tx.select().from(schema.operations).where(eq(schema.operations.status, 'queued')).orderBy(asc(schema.operations.createdAt)).limit(1).get(); if (!row) return null; const updatedAt = now(); tx.update(schema.operations).set({ status: 'running', attempts: row.attempts + 1, updatedAt }).where(and(eq(schema.operations.id, row.id), eq(schema.operations.status, 'queued'))).run(); return mapOperation({ ...row, status: 'running', attempts: row.attempts + 1, updatedAt }); }, { behavior: 'immediate' }); }
  recoverOperations(): void { this.db.update(schema.operations).set({ status: 'queued', updatedAt: now() }).where(eq(schema.operations.status, 'running')).run(); }
  completeOperation(id: string, result: Record<string, unknown> = {}): void { this.db.update(schema.operations).set({ status: 'succeeded', result: JSON.stringify(result), errorMessage: null, updatedAt: now() }).where(eq(schema.operations.id, id)).run(); }
  failOperation(id: string, message: string): void { this.db.update(schema.operations).set({ status: 'failed', errorMessage: message, updatedAt: now() }).where(eq(schema.operations.id, id)).run(); }

  activateRelease(blogId: string, themeRevisionId: string, artifact: string): PublishedReleaseRecord { const record: PublishedReleaseRecord = { id: randomUUID(), blogId, themeRevisionId, artifact, active: true, createdAt: now() }; return this.db.transaction((tx) => { tx.update(schema.publishedReleases).set({ active: false }).where(eq(schema.publishedReleases.blogId, blogId)).run(); tx.insert(schema.publishedReleases).values(record).run(); return record; }, { behavior: 'immediate' }); }
  getActiveRelease(blogId: string): PublishedReleaseRecord | null { return this.db.select().from(schema.publishedReleases).where(and(eq(schema.publishedReleases.blogId, blogId), eq(schema.publishedReleases.active, true))).get() ?? null; }
  createPreviewSession(tokenHash: string, userId: string, blogId: string, expiresAt: string): void { this.db.insert(schema.previewSessions).values({ tokenHash, userId, blogId, expiresAt, createdAt: now() }).run(); }
  getPreviewSession(tokenHash: string): { userId: string; blogId: string } | null { return this.db.select({ userId: schema.previewSessions.userId, blogId: schema.previewSessions.blogId }).from(schema.previewSessions).where(and(eq(schema.previewSessions.tokenHash, tokenHash), gt(schema.previewSessions.expiresAt, now()))).get() ?? null; }
}
