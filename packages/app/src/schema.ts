import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
};

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('display_username'),
  ...timestamps,
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (table) => [index('session_user_id_idx').on(table.userId)]);

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  ...timestamps,
}, (table) => [index('account_user_id_idx').on(table.userId)]);

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
}, (table) => [index('verification_identifier_idx').on(table.identifier)]);

export const rateLimit = sqliteTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  sourceType: text('source_type', { enum: ['hackmd', 'notion'] }).notNull(),
  sourceConfig: text('source_config').notNull(),
  state: text('state', { enum: ['initializing', 'ready', 'building', 'failed', 'deleting'] }).notNull(),
  lastError: text('last_error'),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('projects_user_slug_unique').on(table.userId, table.slug),
  check('projects_source_type_check', sql`${table.sourceType} in ('hackmd', 'notion')`),
  check('projects_state_check', sql`${table.state} in ('initializing', 'ready', 'building', 'failed', 'deleting')`),
]);

export const credentials = sqliteTable('credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['notion', 'cloudflare'] }).notNull(),
  label: text('label').notNull(),
  metadata: text('metadata').notNull(),
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  tag: text('tag').notNull(),
  keyVersion: integer('key_version').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [check('credentials_type_check', sql`${table.type} in ('notion', 'cloudflare')`)]);

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['sync', 'build', 'style', 'deploy', 'delete'] }).notNull(),
  status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed'] }).notNull(),
  payload: text('payload').notNull(),
  result: text('result'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('jobs_one_active_per_project').on(table.projectId).where(sql`${table.status} in ('queued', 'running')`),
  check('jobs_type_check', sql`${table.type} in ('sync', 'build', 'style', 'deploy', 'delete')`),
  check('jobs_status_check', sql`${table.status} in ('queued', 'running', 'succeeded', 'failed')`),
]);

export const deployments = sqliteTable('deployments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  providerDeploymentId: text('provider_deployment_id'),
  url: text('url'),
  environment: text('environment'),
  createdAt: text('created_at').notNull(),
});

export const previewSessions = sqliteTable('preview_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
});

export const aiDailyUsage = sqliteTable('ai_daily_usage', {
  usageDate: text('usage_date').notNull(),
  scope: text('scope', { enum: ['user', 'global'] }).notNull(),
  subject: text('subject').notNull(),
  count: integer('count').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.usageDate, table.scope, table.subject] }),
  check('ai_daily_usage_scope_check', sql`${table.scope} in ('user', 'global')`),
  check('ai_daily_usage_count_check', sql`${table.count} >= 0`),
]);

export const authSchema = { user, session, account, verification, rateLimit };
