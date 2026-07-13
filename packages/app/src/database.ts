import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type ProjectState = 'initializing' | 'ready' | 'building' | 'failed' | 'deleting';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobType = 'sync' | 'build' | 'style' | 'deploy' | 'delete';
export type CredentialType = 'notion' | 'cloudflare';

export interface UserRecord {
  id: string;
  issuer: string;
  subject: string;
  email: string | null;
  displayName: string | null;
}

export interface SessionRecord {
  user: UserRecord;
  csrfToken: string;
  expiresAt: string;
}

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

interface RawProjectRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  source_type: 'hackmd' | 'notion';
  source_config: string;
  state: ProjectState;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface RawCredentialRow {
  id: string;
  user_id: string;
  type: CredentialType;
  label: string;
  metadata: string;
  ciphertext: string;
  nonce: string;
  tag: string;
  key_version: number;
  created_at: string;
}

interface RawJobRow {
  id: string;
  user_id: string;
  project_id: string;
  type: JobType;
  status: JobStatus;
  payload: string;
  result: string | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

const MIGRATION_1 = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (issuer, subject)
  ) STRICT;

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE oidc_flows (
    state TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('hackmd', 'notion')),
    source_config TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('initializing', 'ready', 'building', 'failed', 'deleting')),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, slug)
  ) STRICT;

  CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('notion', 'cloudflare')),
    label TEXT NOT NULL,
    metadata TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    tag TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('sync', 'build', 'style', 'deploy', 'delete')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    payload TEXT NOT NULL,
    result TEXT,
    error_code TEXT,
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE UNIQUE INDEX jobs_one_active_per_project
    ON jobs(project_id)
    WHERE status IN ('queued', 'running');

  CREATE TABLE deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_deployment_id TEXT,
    url TEXT,
    environment TEXT,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE preview_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
`;

const MIGRATION_2 = 'ALTER TABLE projects ADD COLUMN deleted_at TEXT;';

function now(): string {
  return new Date().toISOString();
}

function parseJson(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function mapProject(row: RawProjectRow): ProjectRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    sourceType: row.source_type,
    sourceConfig: parseJson(row.source_config),
    state: row.state,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCredential(row: RawCredentialRow): CredentialRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    label: row.label,
    metadata: parseJson(row.metadata),
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    tag: row.tag,
    keyVersion: row.key_version,
    createdAt: row.created_at,
  };
}

function mapJob(row: RawJobRow): JobRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    payload: parseJson(row.payload),
    result: row.result ? parseJson(row.result) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AppDatabase {
  readonly connection: DatabaseSync;

  constructor(dataRoot: string, databasePath = join(dataRoot, 'vibelog.sqlite')) {
    mkdirSync(dataRoot, { recursive: true });
    this.connection = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
    this.connection.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    this.connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;');
    const migrations = [[1, MIGRATION_1], [2, MIGRATION_2]] as const;
    for (const [version, sql] of migrations) {
      const applied = this.connection.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
      if (applied) continue;
      this.connection.exec('BEGIN IMMEDIATE;');
      try {
        this.connection.exec(sql);
        this.connection.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, now());
        this.connection.exec('COMMIT;');
      } catch (error) {
        this.connection.exec('ROLLBACK;');
        throw error;
      }
    }
  }

  close(): void {
    this.connection.close();
  }

  upsertUser(input: Omit<UserRecord, 'id'>): UserRecord {
    const timestamp = now();
    const existing = this.connection.prepare('SELECT * FROM users WHERE issuer = ? AND subject = ?')
      .get(input.issuer, input.subject) as (UserRecord & { display_name?: string }) | undefined;
    if (existing) {
      this.connection.prepare('UPDATE users SET email = ?, display_name = ?, updated_at = ? WHERE id = ?')
        .run(input.email, input.displayName, timestamp, existing.id);
      return { ...input, id: existing.id };
    }

    const id = randomUUID();
    this.connection.prepare(`
      INSERT INTO users (id, issuer, subject, email, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.issuer, input.subject, input.email, input.displayName, timestamp, timestamp);
    return { ...input, id };
  }

  createSession(tokenHash: string, userId: string, csrfToken: string, expiresAt: string): void {
    this.connection.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(tokenHash, userId, csrfToken, expiresAt, now());
  }

  getSession(tokenHash: string): SessionRecord | null {
    const row = this.connection.prepare(`
      SELECT u.id, u.issuer, u.subject, u.email, u.display_name, s.csrf_token, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash, now()) as {
      id: string; issuer: string; subject: string; email: string | null;
      display_name: string | null; csrf_token: string; expires_at: string;
    } | undefined;
    if (!row) return null;
    return {
      user: {
        id: row.id,
        issuer: row.issuer,
        subject: row.subject,
        email: row.email,
        displayName: row.display_name,
      },
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
    };
  }

  deleteSession(tokenHash: string): void {
    this.connection.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  createOidcFlow(state: string, codeVerifier: string, nonce: string, expiresAt: string): void {
    this.connection.prepare('INSERT INTO oidc_flows (state, code_verifier, nonce, expires_at) VALUES (?, ?, ?, ?)')
      .run(state, codeVerifier, nonce, expiresAt);
  }

  takeOidcFlow(state: string): { codeVerifier: string; nonce: string } | null {
    this.connection.exec('BEGIN IMMEDIATE;');
    try {
      const row = this.connection.prepare('SELECT code_verifier, nonce FROM oidc_flows WHERE state = ? AND expires_at > ?')
        .get(state, now()) as { code_verifier: string; nonce: string } | undefined;
      this.connection.prepare('DELETE FROM oidc_flows WHERE state = ?').run(state);
      this.connection.exec('COMMIT;');
      return row ? { codeVerifier: row.code_verifier, nonce: row.nonce } : null;
    } catch (error) {
      this.connection.exec('ROLLBACK;');
      throw error;
    }
  }

  createCredential(input: Omit<CredentialRecord, 'id' | 'createdAt'>): CredentialRecord {
    const id = randomUUID();
    const createdAt = now();
    this.connection.prepare(`
      INSERT INTO credentials (id, user_id, type, label, metadata, ciphertext, nonce, tag, key_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.userId, input.type, input.label, JSON.stringify(input.metadata), input.ciphertext, input.nonce, input.tag, input.keyVersion, createdAt);
    return { ...input, id, createdAt };
  }

  getCredential(id: string, userId: string, type?: CredentialType): CredentialRecord | null {
    const row = this.connection.prepare('SELECT * FROM credentials WHERE id = ? AND user_id = ?')
      .get(id, userId) as RawCredentialRow | undefined;
    if (!row || (type && row.type !== type)) return null;
    return mapCredential(row);
  }

  listCredentials(userId: string): Omit<CredentialRecord, 'ciphertext' | 'nonce' | 'tag'>[] {
    const rows = this.connection.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as unknown as RawCredentialRow[];
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      label: row.label,
      metadata: parseJson(row.metadata),
      keyVersion: row.key_version,
      createdAt: row.created_at,
    }));
  }

  createProject(input: Omit<ProjectRecord, 'id' | 'state' | 'lastError' | 'createdAt' | 'updatedAt'>): ProjectRecord {
    const id = randomUUID();
    const timestamp = now();
    this.connection.prepare(`
      INSERT INTO projects (id, user_id, name, slug, source_type, source_config, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'initializing', ?, ?)
    `).run(id, input.userId, input.name, input.slug, input.sourceType, JSON.stringify(input.sourceConfig), timestamp, timestamp);
    return { ...input, id, state: 'initializing', lastError: null, createdAt: timestamp, updatedAt: timestamp };
  }

  getProject(id: string, userId: string): ProjectRecord | null {
    const row = this.connection.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .get(id, userId) as RawProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  listProjects(userId: string): ProjectRecord[] {
    const rows = this.connection.prepare('SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(userId) as unknown as RawProjectRow[];
    return rows.map(mapProject);
  }

  updateProjectState(id: string, state: ProjectState, lastError: string | null = null): void {
    this.connection.prepare('UPDATE projects SET state = ?, last_error = ?, updated_at = ? WHERE id = ?')
      .run(state, lastError, now(), id);
  }

  removeProjectRecord(id: string): void {
    this.connection.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  markProjectDeleted(id: string): void {
    this.connection.prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now(), now(), id);
  }

  createJob(userId: string, projectId: string, type: JobType, payload: Record<string, unknown> = {}): JobRecord {
    const id = randomUUID();
    const timestamp = now();
    this.connection.prepare(`
      INSERT INTO jobs (id, user_id, project_id, type, status, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
    `).run(id, userId, projectId, type, JSON.stringify(payload), timestamp, timestamp);
    return {
      id,
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

  getJob(id: string, userId: string): JobRecord | null {
    const row = this.connection.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?')
      .get(id, userId) as RawJobRow | undefined;
    return row ? mapJob(row) : null;
  }

  claimNextJob(): JobRecord | null {
    this.connection.exec('BEGIN IMMEDIATE;');
    try {
      const row = this.connection.prepare('SELECT * FROM jobs WHERE status = \'queued\' ORDER BY created_at LIMIT 1')
        .get() as RawJobRow | undefined;
      if (!row) {
        this.connection.exec('COMMIT;');
        return null;
      }
      this.connection.prepare('UPDATE jobs SET status = \'running\', attempts = attempts + 1, updated_at = ? WHERE id = ?')
        .run(now(), row.id);
      this.connection.exec('COMMIT;');
      return { ...mapJob(row), status: 'running', attempts: row.attempts + 1 };
    } catch (error) {
      this.connection.exec('ROLLBACK;');
      throw error;
    }
  }

  recoverRunningJobs(): void {
    this.connection.prepare('UPDATE jobs SET status = \'queued\', updated_at = ? WHERE status = \'running\'').run(now());
  }

  completeJob(id: string, result: Record<string, unknown> = {}): void {
    this.connection.prepare('UPDATE jobs SET status = \'succeeded\', result = ?, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(result), now(), id);
  }

  failJob(id: string, code: string, message: string): void {
    this.connection.prepare('UPDATE jobs SET status = \'failed\', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?')
      .run(code, message, now(), id);
  }

  createDeployment(projectId: string, input: { providerDeploymentId?: string; url?: string; environment?: string }): string {
    const id = randomUUID();
    this.connection.prepare(`
      INSERT INTO deployments (id, project_id, provider, provider_deployment_id, url, environment, created_at)
      VALUES (?, ?, 'cloudflare', ?, ?, ?, ?)
    `).run(id, projectId, input.providerDeploymentId ?? null, input.url ?? null, input.environment ?? null, now());
    return id;
  }

  listDeployments(projectId: string): Record<string, unknown>[] {
    return this.connection.prepare(`
      SELECT id, provider, provider_deployment_id AS providerDeploymentId, url, environment, created_at AS createdAt
      FROM deployments WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId) as unknown as Record<string, unknown>[];
  }

  createPreviewSession(tokenHash: string, userId: string, projectId: string, expiresAt: string): void {
    this.connection.prepare('INSERT INTO preview_sessions (token_hash, user_id, project_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(tokenHash, userId, projectId, expiresAt, now());
  }

  getPreviewSession(tokenHash: string, projectId?: string): { userId: string; projectId: string } | null {
    const row = this.connection.prepare(`
      SELECT user_id, project_id FROM preview_sessions
      WHERE token_hash = ? AND expires_at > ?
    `).get(tokenHash, now()) as { user_id: string; project_id: string } | undefined;
    if (!row || (projectId && row.project_id !== projectId)) return null;
    return { userId: row.user_id, projectId: row.project_id };
  }
}
