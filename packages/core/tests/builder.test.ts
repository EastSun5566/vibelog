import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentSourceName, createDevBuilder } from '../src/index.js';
import type { ContentSource } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('DevBuilder content summary', () => {
  it('returns normalized metadata without article bodies and reads the source once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-')); roots.push(root);
    const getAuthor = vi.fn(() => Promise.resolve({ name: 'Writer', bio: 'Public notes' }));
    const getPosts = vi.fn(() => Promise.resolve({ posts: [
      { id: 'older', title: 'Older', slug: 'Older Post', date: '2026-01-01T00:00:00Z', content: 'private body one' },
      { id: 'newer', title: 'Newer', slug: 'Newer Post', date: '2026-02-01T00:00:00Z', content: 'private body two' },
    ] }));
    const source: ContentSource = { name: ContentSourceName.HACKMD, getAuthor, getPosts };
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });

    const summary = await builder.fetchContent();

    expect(getAuthor).toHaveBeenCalledOnce();
    expect(getPosts).toHaveBeenCalledOnce();
    expect(summary).toEqual({
      author: { name: 'Writer', bio: 'Public notes' },
      posts: [
        { title: 'Newer', slug: 'newer-post', publishedAt: '2026-02-01T00:00:00.000Z', included: true },
        { title: 'Older', slug: 'older-post', publishedAt: '2026-01-01T00:00:00.000Z', included: true },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain('private body');
  });

  it('writes only selected posts while retaining the full manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-selection-')); roots.push(root);
    const source: ContentSource = {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: 'Public notes' }),
      getPosts: () => Promise.resolve({ posts: [
        { id: 'one', title: 'One', slug: 'one', date: '2026-01-01T00:00:00Z', content: 'One body' },
        { id: 'two', title: 'Two', slug: 'two', date: '2026-02-01T00:00:00Z', content: 'Two body' },
      ] }),
    };
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });

    const summary = await builder.fetchContent({ excludedSlugs: ['one'] });

    expect(summary.posts).toEqual([
      { title: 'Two', slug: 'two', publishedAt: '2026-02-01T00:00:00.000Z', included: true },
      { title: 'One', slug: 'one', publishedAt: '2026-01-01T00:00:00.000Z', included: false },
    ]);
    expect(await readdir(join(root, '.vibelog', 'src', 'content', 'blog'))).toEqual(['two.md']);
    await expect(builder.fetchContent({ excludedSlugs: ['one', 'two'] })).rejects.toThrow('No articles selected');
  });
});
