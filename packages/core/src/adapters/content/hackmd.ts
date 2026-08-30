import assert from 'node:assert/strict';

import { z } from 'zod';

import type { ContentSource, Post } from '../../types.js';
import { logger } from '../../core/index.js';
import { ContentSourceName } from '../../consts.js';
import { removeFirstH1IfMatchesTitle } from './utils.js';
import { sanitizeMarkdown } from '../../markdown.js';
import { slugify } from '../../core/utils.js';

const BASE_URL = 'https://hackmd.io';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const DOWNLOAD_CONCURRENCY = 4;
const MAX_PUBLIC_POSTS = 200;
const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
const MAX_SYNC_BYTES = 32 * 1024 * 1024;
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_OVERVIEW_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 5_000;
const RETRY_DELAYS_MS = [250, 1_000] as const;
const HACKMD_SOURCE_ERROR = Symbol.for('@vibelog/core/HackMdSourceError');

export type HackMdSourceErrorCode =
  | 'profile_not_found'
  | 'article_not_found'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'request_timeout'
  | 'request_rejected'
  | 'invalid_response'
  | 'metadata_too_large'
  | 'too_many_articles'
  | 'article_too_large'
  | 'sync_too_large'
  | 'no_public_articles'
  | 'invalid_published_date'
  | 'invalid_modified_date'
  | 'invalid_slug'
  | 'duplicate_slug';

export class HackMdSourceError extends Error {
  readonly [HACKMD_SOURCE_ERROR] = true;
  constructor(readonly code: HackMdSourceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HackMdSourceError';
  }
}

export function isHackMdSourceError(error: unknown): error is HackMdSourceError {
  return error instanceof Error
    && (error as Error & { [HACKMD_SOURCE_ERROR]?: unknown })[HACKMD_SOURCE_ERROR] === true;
}

const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  tags: z.array(z.string()).nullish().transform((value) => value ?? []),
  lastchangeAt: z.string().nullish().transform((value) => value ?? ''),
  publishType: z.string(),
  publishedAt: z.string().nullish().transform((value) => value ?? ''),
  permalink: z.string().nullish().transform((value) => value ?? undefined),
}).passthrough();
const overviewSchema = z.object({ notes: z.array(noteSchema) }).passthrough();
const personSchema = z.object({
  displayName: z.string().nullish(),
  biography: z.string().nullish(),
}).passthrough();
const teamSchema = z.object({
  name: z.string().nullish(),
  description: z.string().nullish(),
}).passthrough();
const profileSchema = z.object({
  user: personSchema.nullish(),
  team: teamSchema.nullish(),
}).passthrough().refine((value) => Boolean(value.user ?? value.team));

type RequestResource = 'profile' | 'overview' | 'article';
interface LimitedText { text: string; bytes: number }
interface PreparedNote {
  id: string;
  title: string;
  slug: string;
  date: string;
  tags: string[];
  updatedAt?: string;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('HackMD request cancelled');
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function statusError(status: number, resource: RequestResource): HackMdSourceError {
  if (status === 404) {
    const code = resource === 'article' ? 'article_not_found' : 'profile_not_found';
    return new HackMdSourceError(code, resource === 'article' ? 'A HackMD article is no longer available' : 'HackMD profile not found');
  }
  if (status === 429) return new HackMdSourceError('rate_limited', 'HackMD rate limit exceeded');
  if (status === 408 || status === 425 || status >= 500) return new HackMdSourceError('temporarily_unavailable', 'HackMD is temporarily unavailable');
  return new HackMdSourceError('request_rejected', `HackMD rejected the request with status ${String(status)}`);
}

function retryDelay(response: Response | null, attempt: number): number {
  const value = response?.headers.get('retry-after')?.trim();
  if (value) {
    const seconds = /^\d+(?:\.\d+)?$/u.test(value) ? Number(value) * 1_000 : Number.NaN;
    const dateDelay = Number.isNaN(seconds) ? Date.parse(value) - Date.now() : Number.NaN;
    const parsed = Number.isNaN(seconds) ? dateDelay : seconds;
    if (Number.isFinite(parsed)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Math.ceil(parsed)));
  }
  return RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS[0];
}

async function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(abortError(signal));
    };
    const timeout = setTimeout(() => {
      finish();
      resolve();
    }, delay);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function sizeError(resource: RequestResource): HackMdSourceError {
  return resource === 'article'
    ? new HackMdSourceError('article_too_large', 'A HackMD article exceeds the 2 MiB limit')
    : new HackMdSourceError('metadata_too_large', 'HackMD metadata response exceeds its size limit');
}

async function readLimitedText(response: Response, maxBytes: number, resource: RequestResource): Promise<LimitedText> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw sizeError(resource);
  }
  if (!response.body) return { text: '', bytes: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw sizeError(resource);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { text, bytes };
  } finally {
    reader.releaseLock();
  }
}

async function requestText(url: string, resource: RequestResource, maxBytes: number, signal: AbortSignal): Promise<LimitedText> {
  let lastError: HackMdSourceError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw abortError(signal);
    const timeoutController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new DOMException('HackMD request timed out', 'TimeoutError'));
    }, REQUEST_TIMEOUT_MS);
    const attemptSignal = AbortSignal.any([signal, timeoutController.signal]);
    let response: Response | null = null;
    try {
      response = await fetch(url, { signal: attemptSignal });
      if (!response.ok) {
        const error = statusError(response.status, resource);
        if (!retryableStatus(response.status) || attempt === MAX_ATTEMPTS) throw error;
        lastError = error;
        await response.body?.cancel().catch(() => undefined);
      } else {
        try {
          return await readLimitedText(response, maxBytes, resource);
        } catch (error) {
          if (error instanceof HackMdSourceError) throw error;
          if (signal.aborted) throw abortError(signal);
          const controlled = new HackMdSourceError(timedOut ? 'request_timeout' : 'temporarily_unavailable', timedOut ? 'HackMD request timed out' : 'HackMD response stream failed', { cause: error });
          if (attempt === MAX_ATTEMPTS) throw controlled;
          lastError = controlled;
        }
      }
    } catch (error) {
      if (error instanceof HackMdSourceError) {
        if (!retryableStatus(response?.status ?? 0) || attempt === MAX_ATTEMPTS) throw error;
        lastError = error;
      } else {
        if (signal.aborted) throw abortError(signal);
        const controlled = new HackMdSourceError(timedOut ? 'request_timeout' : 'temporarily_unavailable', timedOut ? 'HackMD request timed out' : 'HackMD network request failed', { cause: error });
        if (attempt === MAX_ATTEMPTS) throw controlled;
        lastError = controlled;
      }
    } finally {
      clearTimeout(timeout);
    }
    await waitForRetry(retryDelay(response, attempt), signal);
  }
  throw lastError ?? new HackMdSourceError('temporarily_unavailable', 'HackMD request failed');
}

async function requestJson<Output>(url: string, resource: RequestResource, maxBytes: number, parse: (input: unknown) => Output, signal: AbortSignal): Promise<Output> {
  const response = await requestText(url, resource, maxBytes, signal);
  try {
    const input: unknown = JSON.parse(response.text);
    return parse(input);
  } catch (error) {
    throw new HackMdSourceError('invalid_response', 'HackMD returned an invalid response', { cause: error });
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, task: (item: T, signal: AbortSignal) => Promise<R>): Promise<R[]> {
  const controller = new AbortController();
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: Error | undefined;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!controller.signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index], controller.signal);
      } catch (error) {
        if (firstError === undefined) {
          firstError = error instanceof Error ? error : new Error('HackMD article download failed');
          controller.abort(firstError);
        }
      }
    }
  });
  await Promise.allSettled(workers);
  if (firstError !== undefined) throw firstError;
  return results;
}

function prepareNotes(notes: z.infer<typeof noteSchema>[]): PreparedNote[] {
  const publicNotes = notes.filter((note) => note.publishType === 'view' && note.publishedAt);
  if (publicNotes.length === 0) throw new HackMdSourceError('no_public_articles', 'No public published HackMD articles were found');
  if (publicNotes.length > MAX_PUBLIC_POSTS) throw new HackMdSourceError('too_many_articles', 'HackMD profile exceeds the 200 article limit');

  const slugs = new Set<string>();
  return publicNotes.map((note) => {
    const date = new Date(note.publishedAt);
    if (Number.isNaN(date.getTime())) throw new HackMdSourceError('invalid_published_date', 'A HackMD article has an invalid published date');
    let updatedAt: string | undefined;
    if (note.lastchangeAt) {
      const modifiedDate = new Date(note.lastchangeAt);
      if (Number.isNaN(modifiedDate.getTime())) throw new HackMdSourceError('invalid_modified_date', 'A HackMD article has an invalid modified date');
      if (modifiedDate.getTime() > date.getTime()) updatedAt = modifiedDate.toISOString();
    }
    const slug = slugify(note.permalink ?? note.title);
    if (!slug) throw new HackMdSourceError('invalid_slug', 'A HackMD article has no usable slug');
    if (slugs.has(slug)) throw new HackMdSourceError('duplicate_slug', 'Multiple HackMD articles have the same slug');
    slugs.add(slug);
    return { id: note.id, title: note.title, slug, date: date.toISOString(), tags: note.tags, ...(updatedAt ? { updatedAt } : {}) };
  });
}

export class HackMdSource implements ContentSource {
  readonly name = ContentSourceName.HACKMD;
  private readonly baseUrl: string;
  constructor(readonly username: string, options: { baseUrl?: string } = {}) {
    logger.info(`Content source: HackMD (${username})`);
    assert(username, 'HackMD username is required');
    this.baseUrl = new URL(options.baseUrl ?? BASE_URL).origin;
  }

  async getPosts() {
    const overviewController = new AbortController();
    const overview = await requestJson(`${this.baseUrl}/api/@${this.username}/overview`, 'overview', MAX_OVERVIEW_BYTES, (input) => overviewSchema.parse(input), overviewController.signal);
    const notes = prepareNotes(overview.notes);
    let totalBytes = 0;
    const posts = await mapConcurrent(notes, DOWNLOAD_CONCURRENCY, async (note, signal): Promise<Post> => {
      const result = await requestText(`${this.baseUrl}/${note.id}/download`, 'article', MAX_ARTICLE_BYTES, signal);
      totalBytes += result.bytes;
      if (totalBytes > MAX_SYNC_BYTES) throw new HackMdSourceError('sync_too_large', 'HackMD articles exceed the 32 MiB sync limit');
      return {
        id: note.id,
        title: note.title,
        content: sanitizeMarkdown(removeFirstH1IfMatchesTitle(result.text, note.title)),
        slug: note.slug,
        date: note.date,
        tags: note.tags,
        ...(note.updatedAt ? { updatedAt: note.updatedAt } : {}),
      };
    });
    return { posts };
  }

  async getAuthor() {
    const controller = new AbortController();
    const { user, team } = await requestJson(`${this.baseUrl}/info/@${this.username}`, 'profile', MAX_PROFILE_BYTES, (input) => profileSchema.parse(input), controller.signal);
    return {
      name: user?.displayName ?? team?.name ?? 'Unknown',
      bio: user?.biography ?? team?.description ?? '',
    };
  }
}
