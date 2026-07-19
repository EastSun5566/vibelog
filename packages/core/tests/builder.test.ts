import { mkdtemp, rm } from 'node:fs/promises';
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
        { title: 'Newer', slug: 'newer-post', publishedAt: '2026-02-01T00:00:00.000Z' },
        { title: 'Older', slug: 'older-post', publishedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain('private body');
  });
});
