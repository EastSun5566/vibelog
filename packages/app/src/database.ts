import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3/driver';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzleNodeSqlite } from './node-sqlite-drizzle.js';
import * as schema from './schema.js';

export type ProjectState = 'initializing' | 'ready' | 'building' | 'failed' | 'deleting';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobType = 'sync' | 'build' | 'style' | 'deploy' | 'delete';
export type CredentialType = 'notion' | 'cloudflare';

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  slug: string;
  sourceType: 'hackmd' | 'notion';
  sourceConfig: Record<string, unknown>;
  state: ProjectState;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialRecord {
  id: string;
  userId: string;
  type: CredentialType;
  label: string;
  metadata: Record<string, unknown>;
  ciphertext: string;
  nonce: string;
  tag: string;
  keyVersion: number;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  userId: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiQuotaLimits {
  userDailyLimit: number;
  globalDailyLimit: number;
  at?: Date;
}

export class AiQuotaExceededError extends Error {
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    super('AI daily quota exceeded');
    this.name = 'AiQuotaExceededError';
    this.retryAfter = retryAfter;
  }
}

function now(): string {
  return new Date().toISOString();
}

function parseJson(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function mapProject(row: typeof schema.projects.$inferSelect): ProjectRecord {
  return { ...row, sourceConfig: parseJson(row.sourceConfig) };
}

function mapCredential(row: typeof schema.credentials.$inferSelect): CredentialRecord {
  return { ...row, metadata: parseJson(row.metadata) };
}

function mapJob(row: typeof schema.jobs.$inferSelect): JobRecord {
  return {
    ...row,
    payload: parseJson(row.payload),
    result: row.result ? parseJson(row.result) : null,
  };
}

function queuedJob(userId: string, projectId: string, type: JobType, payload: Record<string, unknown>): JobRecord {
  const timestamp = now();
  return {
    id: randomUUID(),
    userId,
    projectId,
    type,
    status: 'queued',
    payload,
    result: null,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function jobValues(job: JobRecord): typeof schema.jobs.$inferInsert {
  return {
    ...job,
    payload: JSON.stringify(job.payload),
    result: job.result ? JSON.stringify(job.result) : null,
  };
}

function utcQuotaWindow(at: Date): { date: string; retryAfter: number } {
  const date = at.toISOString().slice(0, 10);
  const nextMidnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return { date, retryAfter: Math.max(1, Math.ceil((nextMidnight - at.getTime()) / 1000)) };
}

function migrateDatabase(db: BetterSQLite3Database<typeof schema>, migrationsFolder: string): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  db.run(sql.raw(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `));
  db.run(sql.raw('BEGIN IMMEDIATE'));
  try {
    const last = db.values<[number, string, number]>(sql.raw(
      'SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
    ))[0];
    for (const migration of migrations) {
      if (last && last[2] >= migration.folderMillis) continue;
      for (const statement of migration.sql) db.run(sql.raw(statement));
      db.run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`);
    }
    db.run(sql.raw('COMMIT'));
  } catch (error) {
    db.run(sql.raw('ROLLBACK'));
    throw error;
  }
}

export class AppDatabase {
  readonly connection: DatabaseSync;
  readonly db: BetterSQLite3Database<typeof schema>;

  constructor(dataRoot: string, databasePath = join(dataRoot, 'vibelog.sqlite')) {
    mkdirSync(dataRoot, { recursive: true });
    this.connection = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
    this.connection.exec('PRAGMA busy_timeout = 5000;');
    this.connection.exec('PRAGMA journal_mode = WAL;');
    this.db = drizzleNodeSqlite(this.connection, schema);
    migrateDatabase(this.db, fileURLToPath(new URL('./drizzle', import.meta.url)));
  }

  close(): void {
    this.connection.close();
  }

  createCredential(input: Omit<CredentialRecord, 'id' | 'createdAt'>): CredentialRecord {
    const record = { ...input, id: randomUUID(), createdAt: now() };
    this.db.insert(schema.credentials).values({ ...record, metadata: JSON.stringify(record.metadata) }).run();
    return record;
  }

  getCredential(id: string, userId: string, type?: CredentialType): CredentialRecord | null {
    const row = this.db.select().from(schema.credentials)
      .where(and(eq(schema.credentials.id, id), eq(schema.credentials.userId, userId))).get();
    if (!row || (type && row.type !== type)) return null;
    return mapCredential(row);
  }

  listCredentials(userId: string): Omit<CredentialRecord, 'ciphertext' | 'nonce' | 'tag'>[] {
    return this.db.select().from(schema.credentials).where(eq(schema.credentials.userId, userId))
      .orderBy(desc(schema.credentials.createdAt)).all().map((row) => {
        const credential = mapCredential(row);
        const { ciphertext: _ciphertext, nonce: _nonce, tag: _tag, ...safe } = credential;
        return safe;
      });
  }

  createProject(input: Omit<ProjectRecord, 'id' | 'state' | 'lastError' | 'createdAt' | 'updatedAt'>): ProjectRecord {
    const timestamp = now();
    const record: ProjectRecord = { ...input, id: randomUUID(), state: 'initializing', lastError: null, createdAt: timestamp, updatedAt: timestamp };
    this.db.insert(schema.projects).values({ ...record, sourceConfig: JSON.stringify(record.sourceConfig) }).run();
    return record;
  }

  getProject(id: string, userId: string): ProjectRecord | null {
    const row = this.db.select().from(schema.projects).where(and(
      eq(schema.projects.id, id),
      eq(schema.projects.userId, userId),
      isNull(schema.projects.deletedAt),
    )).get();
    return row ? mapProject(row) : null;
  }

  listProjects(userId: string): ProjectRecord[] {
    return this.db.select().from(schema.projects).where(and(
      eq(schema.projects.userId, userId),
      isNull(schema.projects.deletedAt),
    )).orderBy(desc(schema.projects.createdAt)).all().map(mapProject);
  }

  updateProjectState(id: string, state: ProjectState, lastError: string | null = null): void {
    this.db.update(schema.projects).set({ state, lastError, updatedAt: now() }).where(eq(schema.projects.id, id)).run();
  }

  removeProjectRecord(id: string): void {
    this.db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
  }

  markProjectDeleted(id: string): void {
    const timestamp = now();
    this.db.update(schema.projects).set({ deletedAt: timestamp, updatedAt: timestamp }).where(eq(schema.projects.id, id)).run();
  }

  createJob(userId: string, projectId: string, type: JobType, payload: Record<string, unknown> = {}): JobRecord {
    const job = queuedJob(userId, projectId, type, payload);
    this.db.insert(schema.jobs).values(jobValues(job)).run();
    return job;
  }

  createStyleJob(userId: string, projectId: string, payload: Record<string, unknown>, limits: AiQuotaLimits): JobRecord {
    const at = limits.at ?? new Date();
    const window = utcQuotaWindow(at);
    const job = queuedJob(userId, projectId, 'style', payload);
    return this.db.transaction((tx) => {
      const active = tx.select({ id: schema.jobs.id }).from(schema.jobs).where(and(
        eq(schema.jobs.projectId, projectId),
        inArray(schema.jobs.status, ['queued', 'running']),
      )).get();
      if (active) throw new Error('Project already has an active job');

      const usage = tx.select().from(schema.aiDailyUsage).where(and(
        eq(schema.aiDailyUsage.usageDate, window.date),
        sql`(${schema.aiDailyUsage.scope} = 'global' or ${schema.aiDailyUsage.subject} = ${userId})`,
      )).all();
      const userCount = usage.find((entry) => entry.scope === 'user')?.count ?? 0;
      const globalCount = usage.find((entry) => entry.scope === 'global')?.count ?? 0;
      if (userCount >= limits.userDailyLimit || globalCount >= limits.globalDailyLimit) {
        throw new AiQuotaExceededError(window.retryAfter);
      }

      tx.insert(schema.jobs).values(jobValues(job)).run();
      for (const counter of [
        { scope: 'user' as const, subject: userId },
        { scope: 'global' as const, subject: '*' },
      ]) {
        tx.insert(schema.aiDailyUsage).values({ usageDate: window.date, ...counter, count: 1 }).onConflictDoUpdate({
          target: [schema.aiDailyUsage.usageDate, schema.aiDailyUsage.scope, schema.aiDailyUsage.subject],
          set: { count: sql`${schema.aiDailyUsage.count} + 1` },
        }).run();
      }
      return job;
    }, { behavior: 'immediate' });
  }

  getJob(id: string, userId: string): JobRecord | null {
    const row = this.db.select().from(schema.jobs).where(and(eq(schema.jobs.id, id), eq(schema.jobs.userId, userId))).get();
    return row ? mapJob(row) : null;
  }

  claimNextJob(): JobRecord | null {
    return this.db.transaction((tx) => {
      const row = tx.select().from(schema.jobs).where(eq(schema.jobs.status, 'queued'))
        .orderBy(asc(schema.jobs.createdAt)).limit(1).get();
      if (!row) return null;
      const updatedAt = now();
      tx.update(schema.jobs).set({ status: 'running', attempts: row.attempts + 1, updatedAt })
        .where(and(eq(schema.jobs.id, row.id), eq(schema.jobs.status, 'queued'))).run();
      return mapJob({ ...row, status: 'running', attempts: row.attempts + 1, updatedAt });
    }, { behavior: 'immediate' });
  }

  recoverRunningJobs(): void {
    this.db.update(schema.jobs).set({ status: 'queued', updatedAt: now() }).where(eq(schema.jobs.status, 'running')).run();
  }

  completeJob(id: string, result: Record<string, unknown> = {}): void {
    this.db.update(schema.jobs).set({ status: 'succeeded', result: JSON.stringify(result), errorCode: null, errorMessage: null, updatedAt: now() })
      .where(eq(schema.jobs.id, id)).run();
  }

  failJob(id: string, code: string, message: string): void {
    this.db.update(schema.jobs).set({ status: 'failed', errorCode: code, errorMessage: message, updatedAt: now() })
      .where(eq(schema.jobs.id, id)).run();
  }

  createDeployment(projectId: string, input: { providerDeploymentId?: string; url?: string; environment?: string }): string {
    const id = randomUUID();
    this.db.insert(schema.deployments).values({
      id,
      projectId,
      provider: 'cloudflare',
      providerDeploymentId: input.providerDeploymentId ?? null,
      url: input.url ?? null,
      environment: input.environment ?? null,
      createdAt: now(),
    }).run();
    return id;
  }

  listDeployments(projectId: string): Record<string, unknown>[] {
    return this.db.select().from(schema.deployments).where(eq(schema.deployments.projectId, projectId))
      .orderBy(desc(schema.deployments.createdAt)).all();
  }

  createPreviewSession(tokenHash: string, userId: string, projectId: string, expiresAt: string): void {
    this.db.insert(schema.previewSessions).values({ tokenHash, userId, projectId, expiresAt, createdAt: now() }).run();
  }

  getPreviewSession(tokenHash: string, projectId?: string): { userId: string; projectId: string } | null {
    const row = this.db.select({ userId: schema.previewSessions.userId, projectId: schema.previewSessions.projectId })
      .from(schema.previewSessions).where(and(
        eq(schema.previewSessions.tokenHash, tokenHash),
        gt(schema.previewSessions.expiresAt, now()),
      )).get();
    if (!row || (projectId && row.projectId !== projectId)) return null;
    return row;
  }
}
