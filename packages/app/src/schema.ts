import { sql } from 'drizzle-orm';
import {
  boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import type { ThemeConfig } from '@vibelog/core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const user = pgTable('user', {
  id: uuid('id').default(sql`pg_catalog.gen_random_uuid()`).primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'), ...timestamps,
});
export const session = pgTable('session', {
  id: uuid('id').default(sql`pg_catalog.gen_random_uuid()`).primaryKey(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), ipAddress: text('ip_address'),
  userAgent: text('user_agent'), userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (table) => [index('session_user_id_idx').on(table.userId)]);
export const account = pgTable('account', {
  id: uuid('id').default(sql`pg_catalog.gen_random_uuid()`).primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }), accessToken: text('access_token'),
  refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }), scope: text('scope'), ...timestamps,
}, (table) => [index('account_user_id_idx').on(table.userId)]);
export const verification = pgTable('verification', {
  id: uuid('id').default(sql`pg_catalog.gen_random_uuid()`).primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [index('verification_identifier_idx').on(table.identifier)]);
export const rateLimit = pgTable('rate_limit', {
  id: uuid('id').default(sql`pg_catalog.gen_random_uuid()`).primaryKey(), key: text('key').notNull().unique(), count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
});

export const blogs = pgTable('blogs', {
  id: uuid('id').primaryKey(), userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  username: text('username').notNull(), hackmdUsername: text('hackmd_username').notNull(), title: text('title'),
  description: text('description'), author: text('author'), language: text('language').notNull().default('zh-Hant'),
  state: text('state', { enum: ['syncing', 'ready', 'failed'] }).notNull(), lastError: text('last_error'),
  draftArtifactId: uuid('draft_artifact_id'), contentVersion: integer('content_version').notNull().default(0),
  contentManifest: jsonb('content_manifest').$type<unknown[] | null>(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }), ...timestamps,
}, (table) => [
  uniqueIndex('blogs_one_per_user').on(table.userId), uniqueIndex('blogs_username_unique').on(table.username),
  check('blogs_handle_check', sql`${table.username} ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$'`),
  check('blogs_state_check', sql`${table.state} in ('syncing','ready','failed')`),
]);
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey(), blogId: uuid('blog_id').notNull().references(() => blogs.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['draft', 'release'] }).notNull(), keyPrefix: text('key_prefix').notNull().unique(),
  state: text('state', { enum: ['uploading', 'ready', 'cleanup_pending'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readyAt: timestamp('ready_at', { withTimezone: true }),
}, (table) => [
  index('artifacts_blog_idx').on(table.blogId), check('artifacts_kind_check', sql`${table.kind} in ('draft','release')`),
  check('artifacts_state_check', sql`${table.state} in ('uploading','ready','cleanup_pending')`),
]);
export const themeRevisions = pgTable('theme_revisions', {
  id: uuid('id').primaryKey(), blogId: uuid('blog_id').notNull().references(() => blogs.id, { onDelete: 'cascade' }),
  config: jsonb('config').$type<ThemeConfig>().notNull(), prompt: text('prompt'), description: text('description').notNull(),
  source: text('source', { enum: ['system', 'ai', 'manual'] }).notNull().default('system'),
  active: boolean('active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('theme_revisions_blog_idx').on(table.blogId),
  uniqueIndex('theme_revisions_one_active').on(table.blogId).where(sql`${table.active}`),
]);
export const operations = pgTable('operations', {
  id: uuid('id').primaryKey(), userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  blogId: uuid('blog_id').notNull().references(() => blogs.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['sync', 'generate_theme', 'publish'] }).notNull(),
  status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed'] }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown> | null>(), errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0), lockedAt: timestamp('locked_at', { withTimezone: true }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }), ...timestamps,
}, (table) => [
  uniqueIndex('operations_one_active_per_blog').on(table.blogId).where(sql`${table.status} in ('queued','running')`),
  index('operations_claim_idx').on(table.status, table.leaseExpiresAt),
  check('operations_type_check', sql`${table.type} in ('sync','generate_theme','publish')`),
  check('operations_status_check', sql`${table.status} in ('queued','running','succeeded','failed')`),
]);
export const operationOutbox = pgTable('operation_outbox', {
  id: uuid('id').primaryKey(),
  operationId: uuid('operation_id').notNull().unique().references(() => operations.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull().default('operation.requested'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }), attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('operation_outbox_pending_idx').on(table.dispatchedAt, table.createdAt)]);
export const publishedReleases = pgTable('published_releases', {
  id: uuid('id').primaryKey(), blogId: uuid('blog_id').notNull().references(() => blogs.id, { onDelete: 'cascade' }),
  themeRevisionId: uuid('theme_revision_id').notNull().references(() => themeRevisions.id),
  contentVersion: integer('content_version').notNull().default(0),
  snapshot: jsonb('snapshot').$type<Record<string, unknown> | null>(),
  artifactId: uuid('artifact_id').notNull().references(() => artifacts.id),
  active: boolean('active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('published_releases_blog_idx').on(table.blogId),
  uniqueIndex('published_releases_one_active').on(table.blogId).where(sql`${table.active}`),
]);
export const previewSessions = pgTable('preview_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  blogId: uuid('blog_id').notNull().references(() => blogs.id, { onDelete: 'cascade' }),
  themeConfig: jsonb('theme_config').$type<ThemeConfig | null>(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const aiDailyUsage = pgTable('ai_daily_usage', {
  usageDate: date('usage_date').notNull(), scope: text('scope', { enum: ['user', 'global'] }).notNull(),
  subject: text('subject').notNull(), count: integer('count').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.usageDate, table.scope, table.subject] }),
  check('ai_usage_scope_check', sql`${table.scope} in ('user','global')`),
  check('ai_usage_count_check', sql`${table.count} >= 0`),
]);

export const authSchema = { user, session, account, verification, rateLimit };
