import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '@vibelog/core';
import type { BlogRecord, PublishedReleaseRecord, SyncedPostSummary, ThemeRevisionRecord } from '../src/database.js';
import { calculatePublicationDiff, createReleaseSnapshot } from '../src/publication-diff.js';

const post = (slug: string, overrides: Partial<SyncedPostSummary> = {}): SyncedPostSummary => ({
  title: slug,
  slug,
  publishedAt: '2026-01-01T00:00:00.000Z',
  included: true,
  tags: [],
  contentHash: 'a'.repeat(64),
  ...overrides,
});
const blog = (posts: SyncedPostSummary[], overrides: Partial<BlogRecord> = {}): BlogRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  username: 'writer',
  hackmdUsername: 'writer',
  title: 'Writer Journal',
  description: 'Essays',
  author: 'Writer',
  state: 'ready',
  lastError: null,
  draftArtifactId: '66666666-6666-4666-8666-666666666666',
  contentVersion: 2,
  contentManifest: posts,
  lastSyncedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
  language: overrides.language ?? 'en',
});
const theme = (overrides: Partial<ThemeRevisionRecord> = {}): ThemeRevisionRecord => ({
  id: '33333333-3333-4333-8333-333333333333',
  blogId: '11111111-1111-4111-8111-111111111111',
  config: DEFAULT_THEME,
  prompt: null,
  description: 'Current theme',
  source: 'system',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
const release = (source: BlogRecord, overrides: Partial<PublishedReleaseRecord> = {}): PublishedReleaseRecord => ({
  id: '44444444-4444-4444-8444-444444444444',
  blogId: source.id,
  themeRevisionId: theme().id,
  contentVersion: source.contentVersion,
  snapshot: createReleaseSnapshot(source),
  artifactId: '77777777-7777-4777-8777-777777777777',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('publication diff', () => {
  it('describes a first publication without exposing internal identifiers', () => {
    const draft = blog([post('one'), post('hidden', { included: false })]);
    expect(calculatePublicationDiff(draft, theme(), null)).toMatchObject({ mode: 'first', includedCount: 1, rebuilt: false });
  });

  it('classifies added, updated and removed articles by slug', () => {
    const liveBlog = blog([post('kept'), post('changed'), post('renamed-old'), post('excluded-both', { included: false })], { contentVersion: 1 });
    const draft = blog([
      post('kept'),
      post('changed', { contentHash: 'b'.repeat(64) }),
      post('renamed-new'),
      post('excluded-both', { included: false }),
    ]);
    const diff = calculatePublicationDiff(draft, theme(), release(liveBlog));
    expect(diff.added.map(({ slug }) => slug)).toEqual(['renamed-new']);
    expect(diff.updated.map(({ slug }) => slug)).toEqual(['changed']);
    expect(diff.removed.map(({ slug }) => slug)).toEqual(['renamed-old']);
  });

  it('tracks identity and theme independently of article changes', () => {
    const liveBlog = blog([post('one')], { title: 'Old title', description: 'Old description', author: 'Old author', language: 'zh-Hant', contentVersion: 1 });
    const diff = calculatePublicationDiff(blog([post('one')]), theme({ id: '55555555-5555-4555-8555-555555555555' }), release(liveBlog));
    expect(diff.identityChanges).toEqual(['title', 'description', 'author', 'language']);
    expect(diff.themeChanged).toBe(true);
    expect(diff.rebuilt).toBe(false);
  });

  it('ignores tag ordering and a newly introduced digest on a legacy manifest', () => {
    const livePost = post('one', { tags: [{ name: 'Writing', slug: 'writing' }, { name: 'AI', slug: 'ai' }], contentHash: undefined });
    const draftPost = post('one', { tags: [{ name: 'AI', slug: 'ai' }, { name: 'Writing', slug: 'writing' }] });
    const diff = calculatePublicationDiff(blog([draftPost]), theme(), release(blog([livePost], { contentVersion: 1 })));
    expect(diff.updated).toEqual([]);
    expect(diff.rebuilt).toBe(true);
  });

  it('marks semantic-equivalent content-version changes as a rebuilt draft', () => {
    const liveBlog = blog([post('one')], { contentVersion: 1 });
    expect(calculatePublicationDiff(blog([post('one')]), theme(), release(liveBlog))).toMatchObject({ mode: 'tracked', rebuilt: true });
  });

  it('falls back safely for releases created before snapshot tracking', () => {
    const draft = blog([post('one')]);
    expect(calculatePublicationDiff(draft, theme(), release(draft, { snapshot: null, contentVersion: 1 }))).toMatchObject({
      mode: 'legacy',
      rebuilt: true,
      added: [],
      updated: [],
      removed: [],
    });
  });
});
