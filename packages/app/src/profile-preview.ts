import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { BlogDesignSpecV2, ContentProfile } from '@vibelog/core';
import { contentProfileSchema, validateBlogDesignSpecV2 } from '@vibelog/core';
import { z } from 'zod';
import type { AppDatabase } from './database.js';
import type { DesignPresetId } from './design-presets.js';
import * as schema from './schema.js';

/**
 * Anonymous previews: vibelog.org/@name shows the blog VibeLog would build from that HackMD
 * user's public notes. One shared row per profile, so every visitor reuses the same build.
 */

/** HackMD names as accepted elsewhere in the app (see the onboarding form). */
export const hackmdNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}_.-]+$/u);

export const PREVIEW_LABEL_PREFIX = 'try-';

const RESERVED_HANDLES = new Set(['preview', 'www', 'api', 'admin', 'assets']);
/**
 * Subdomains a blog may not claim: app hosts, and the exact shape of anonymous preview hosts.
 * Other `try-` handles stay valid, so blogs that already use one keep being served.
 */
export function isReservedBlogHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle) || isPreviewLabel(handle);
}

export function previewNameKey(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('und');
}

/** A DNS label under the app domain that serves the preview's HTML away from the login origin. */
export function previewLabel(nameKey: string): string {
  return `${PREVIEW_LABEL_PREFIX}${createHash('sha256').update(nameKey).digest('hex').slice(0, 12)}`;
}

export function isPreviewLabel(label: string): boolean {
  return /^try-[0-9a-f]{12}$/u.test(label);
}

export function previewSiteOrigin(appOrigin: string, label: string): string {
  const app = new URL(appOrigin);
  return `${app.protocol}//${label}.${app.hostname}${app.port ? `:${app.port}` : ''}`;
}

/** Picks a starter design from content statistics, without an AI call. */
export function pickPreset(profile: ContentProfile): DesignPresetId {
  if (profile.imageUsage === 'frequent') return 'magazine';
  if (profile.codeUsage === 'frequent' || profile.mathUsage === 'frequent') return 'personality';
  if (profile.averageLength === 'long') return 'readable';
  return 'magazine';
}

/** Chooses the blog language from post titles: mostly CJK reads as Traditional Chinese. */
export function guessLanguage(titles: string[]): string {
  const text = titles.join('');
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return 'en';
  const cjk =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      ?.length ?? 0;
  return cjk / letters >= 0.2 ? 'zh-Hant' : 'en';
}

export type ProfilePreviewState = 'queued' | 'building' | 'ready' | 'failed';
export interface ProfilePreviewRecord {
  id: string;
  nameKey: string;
  hackmdUsername: string;
  label: string;
  state: ProfilePreviewState;
  stage: string | null;
  generation: number;
  attempts: number;
  leaseExpiresAt: string | null;
  sourceArtifactId: string | null;
  draftArtifactId: string | null;
  design: BlogDesignSpecV2 | null;
  designSource: 'preset' | 'ai' | null;
  language: string | null;
  title: string | null;
  author: string | null;
  contentProfile: ContentProfile | null;
  errorMessage: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}
export interface CompletedPreview {
  sourceArtifactId: string;
  draftArtifactId: string;
  design: BlogDesignSpecV2;
  designSource: 'preset' | 'ai';
  language: string;
  title: string;
  author: string;
  contentProfile: ContentProfile;
}
export class PreviewLeaseLostError extends Error {
  constructor() {
    super('Preview lease is no longer owned');
    this.name = 'PreviewLeaseLostError';
  }
}

const iso = (value: Date | null) => value?.toISOString() ?? null;
function mapPreview(row: typeof schema.profilePreviews.$inferSelect): ProfilePreviewRecord {
  return {
    id: row.id,
    nameKey: row.nameKey,
    hackmdUsername: row.hackmdUsername,
    label: row.label,
    state: row.state,
    stage: row.stage,
    generation: row.generation,
    attempts: row.attempts,
    leaseExpiresAt: iso(row.leaseExpiresAt),
    sourceArtifactId: row.sourceArtifactId,
    draftArtifactId: row.draftArtifactId,
    design: row.design ? validateBlogDesignSpecV2(row.design) : null,
    designSource: row.designSource,
    language: row.language,
    title: row.title,
    author: row.author,
    contentProfile: row.contentProfile ? contentProfileSchema.parse(row.contentProfile) : null,
    errorMessage: row.errorMessage,
    generatedAt: iso(row.generatedAt),
    expiresAt: iso(row.expiresAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What a visit should do with the current row. */
export type PreviewVisitAction = 'serve' | 'create' | 'refresh' | 'redispatch' | 'wait' | 'none';
export const PREVIEW_TIMINGS = {
  /** How long a ready preview is reused before a visit rebuilds it. */
  ttlSeconds: 24 * 60 * 60,
  /** How long a failure is shown before a visit may try again. */
  retryAfterFailureSeconds: 5 * 60,
  /** A queued job that nobody claimed within this window is sent again. */
  redispatchAfterSeconds: 2 * 60,
  leaseSeconds: 10 * 60,
  /** Expired previews are deleted after this grace period. */
  pruneAfterSeconds: 7 * 24 * 60 * 60,
} as const;

export function previewVisitAction(
  preview: ProfilePreviewRecord | null,
  at = new Date(),
): PreviewVisitAction {
  if (!preview) return 'create';
  const now = at.getTime();
  const age = (value: string | null) => (value ? now - Date.parse(value) : Infinity);
  if (preview.state === 'ready')
    return preview.expiresAt && Date.parse(preview.expiresAt) > now ? 'serve' : 'refresh';
  if (preview.state === 'failed')
    return age(preview.updatedAt) >= PREVIEW_TIMINGS.retryAfterFailureSeconds * 1000
      ? 'refresh'
      : 'none';
  if (preview.state === 'queued')
    return age(preview.updatedAt) >= PREVIEW_TIMINGS.redispatchAfterSeconds * 1000
      ? 'redispatch'
      : 'wait';
  return preview.leaseExpiresAt && Date.parse(preview.leaseExpiresAt) <= now
    ? 'redispatch'
    : 'wait';
}

export class ProfilePreviewStore {
  constructor(private readonly database: AppDatabase) {}
  private get db() {
    return this.database.db;
  }
  async get(nameKey: string): Promise<ProfilePreviewRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.profilePreviews)
      .where(eq(schema.profilePreviews.nameKey, nameKey));
    return row ? mapPreview(row) : null;
  }
  async getById(id: string): Promise<ProfilePreviewRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.profilePreviews)
      .where(eq(schema.profilePreviews.id, id));
    return row ? mapPreview(row) : null;
  }
  async getByLabel(label: string): Promise<ProfilePreviewRecord | null> {
    const [row] = await this.db
      .select()
      .from(schema.profilePreviews)
      .where(eq(schema.profilePreviews.label, label));
    return row ? mapPreview(row) : null;
  }
  /** Inserts the first generation; null when another visitor created it first. */
  async create(hackmdUsername: string, at = new Date()): Promise<ProfilePreviewRecord | null> {
    const nameKey = previewNameKey(hackmdUsername);
    const [row] = await this.db
      .insert(schema.profilePreviews)
      .values({
        id: randomUUID(),
        nameKey,
        hackmdUsername,
        label: previewLabel(nameKey),
        state: 'queued',
        stage: 'Waiting to start',
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing({ target: schema.profilePreviews.nameKey })
      .returning();
    return row ? mapPreview(row) : null;
  }
  /** Starts the next generation of a ready or failed preview; null when another visitor did. */
  async refresh(
    preview: ProfilePreviewRecord,
    at = new Date(),
  ): Promise<ProfilePreviewRecord | null> {
    const [row] = await this.db
      .update(schema.profilePreviews)
      .set({
        state: 'queued',
        stage: 'Waiting to start',
        generation: sql`${schema.profilePreviews.generation} + 1`,
        attempts: 0,
        leaseExpiresAt: null,
        errorMessage: null,
        updatedAt: at,
      })
      .where(
        and(
          eq(schema.profilePreviews.id, preview.id),
          eq(schema.profilePreviews.generation, preview.generation),
          inArray(schema.profilePreviews.state, ['ready', 'failed']),
        ),
      )
      .returning();
    return row ? mapPreview(row) : null;
  }
  /** Marks an unclaimed or abandoned job as queued again so it can be sent once more. */
  async requeue(preview: ProfilePreviewRecord, at = new Date()): Promise<boolean> {
    const rows = await this.db
      .update(schema.profilePreviews)
      .set({ state: 'queued', leaseExpiresAt: null, updatedAt: at })
      .where(
        and(
          eq(schema.profilePreviews.id, preview.id),
          eq(schema.profilePreviews.generation, preview.generation),
          or(
            eq(schema.profilePreviews.state, 'queued'),
            and(
              eq(schema.profilePreviews.state, 'building'),
              lt(schema.profilePreviews.leaseExpiresAt, at),
            ),
          ),
        ),
      )
      .returning({ id: schema.profilePreviews.id });
    return rows.length > 0;
  }
  async claim(id: string, at = new Date()): Promise<ProfilePreviewRecord | null> {
    const [row] = await this.db
      .update(schema.profilePreviews)
      .set({
        state: 'building',
        stage: 'Reading HackMD',
        attempts: sql`${schema.profilePreviews.attempts} + 1`,
        leaseExpiresAt: new Date(at.getTime() + PREVIEW_TIMINGS.leaseSeconds * 1000),
        updatedAt: at,
      })
      .where(
        and(
          eq(schema.profilePreviews.id, id),
          or(
            eq(schema.profilePreviews.state, 'queued'),
            and(
              eq(schema.profilePreviews.state, 'building'),
              lt(schema.profilePreviews.leaseExpiresAt, at),
            ),
          ),
        ),
      )
      .returning();
    return row ? mapPreview(row) : null;
  }
  async nextQueued(at = new Date()): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.profilePreviews.id })
      .from(schema.profilePreviews)
      .where(
        or(
          eq(schema.profilePreviews.state, 'queued'),
          and(
            eq(schema.profilePreviews.state, 'building'),
            lt(schema.profilePreviews.leaseExpiresAt, at),
          ),
        ),
      )
      .orderBy(asc(schema.profilePreviews.updatedAt))
      .limit(1);
    return row?.id ?? null;
  }
  async setStage(lease: ProfilePreviewRecord, stage: string): Promise<void> {
    const rows = await this.db
      .update(schema.profilePreviews)
      .set({ stage, updatedAt: new Date() })
      .where(this.owned(lease))
      .returning({ id: schema.profilePreviews.id });
    if (rows.length === 0) throw new PreviewLeaseLostError();
  }
  /** Returns the artifacts of the previous generation, which the caller deletes. */
  async complete(
    lease: ProfilePreviewRecord,
    result: CompletedPreview,
    at = new Date(),
  ): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          sourceArtifactId: schema.profilePreviews.sourceArtifactId,
          draftArtifactId: schema.profilePreviews.draftArtifactId,
        })
        .from(schema.profilePreviews)
        .where(this.owned(lease))
        .for('update');
      if (!current) throw new PreviewLeaseLostError();
      await tx
        .update(schema.profilePreviews)
        .set({
          state: 'ready',
          stage: null,
          leaseExpiresAt: null,
          errorMessage: null,
          sourceArtifactId: result.sourceArtifactId,
          draftArtifactId: result.draftArtifactId,
          design: validateBlogDesignSpecV2(result.design),
          designSource: result.designSource,
          language: result.language,
          title: result.title,
          author: result.author,
          contentProfile: result.contentProfile,
          generatedAt: at,
          expiresAt: new Date(at.getTime() + PREVIEW_TIMINGS.ttlSeconds * 1000),
          updatedAt: at,
        })
        .where(eq(schema.profilePreviews.id, lease.id));
      return [current.sourceArtifactId, current.draftArtifactId].filter(
        (id): id is string => typeof id === 'string',
      );
    });
  }
  /** Keeps the last good build, if any, so visitors still see something. */
  async fail(lease: ProfilePreviewRecord, message: string, at = new Date()): Promise<void> {
    await this.db
      .update(schema.profilePreviews)
      .set({
        state: 'failed',
        stage: null,
        leaseExpiresAt: null,
        errorMessage: message,
        updatedAt: at,
      })
      .where(this.owned(lease));
  }
  /** Deletes long-expired previews and returns their artifacts for cleanup. */
  async pruneExpired(at = new Date()): Promise<string[]> {
    const cutoff = new Date(at.getTime() - PREVIEW_TIMINGS.pruneAfterSeconds * 1000);
    const rows = await this.db
      .delete(schema.profilePreviews)
      .where(
        and(
          inArray(schema.profilePreviews.state, ['ready', 'failed']),
          or(
            lt(schema.profilePreviews.expiresAt, cutoff),
            and(
              isNull(schema.profilePreviews.expiresAt),
              lt(schema.profilePreviews.updatedAt, cutoff),
            ),
          ),
        ),
      )
      .returning({
        sourceArtifactId: schema.profilePreviews.sourceArtifactId,
        draftArtifactId: schema.profilePreviews.draftArtifactId,
      });
    return rows
      .flatMap((row) => [row.sourceArtifactId, row.draftArtifactId])
      .filter((id): id is string => typeof id === 'string');
  }
  /** Counts one AI design against the previews' own daily budget; false once it is spent. */
  async consumeAiBudget(limit: number, at = new Date()): Promise<boolean> {
    if (limit < 1) return false;
    const [usage] = await this.db
      .insert(schema.aiDailyUsage)
      .values({
        usageDate: at.toISOString().slice(0, 10),
        scope: 'global',
        subject: 'preview',
        count: 1,
      })
      .onConflictDoUpdate({
        target: [
          schema.aiDailyUsage.usageDate,
          schema.aiDailyUsage.scope,
          schema.aiDailyUsage.subject,
        ],
        set: { count: sql`${schema.aiDailyUsage.count} + 1` },
      })
      .returning({ count: schema.aiDailyUsage.count });
    return Boolean(usage && usage.count <= limit);
  }
  private owned(lease: ProfilePreviewRecord) {
    return and(
      eq(schema.profilePreviews.id, lease.id),
      eq(schema.profilePreviews.generation, lease.generation),
      eq(schema.profilePreviews.attempts, lease.attempts),
      eq(schema.profilePreviews.state, 'building'),
    );
  }
}
