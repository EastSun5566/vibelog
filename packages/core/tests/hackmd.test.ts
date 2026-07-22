import { afterEach, describe, expect, it, vi } from 'vitest';
import { HackMdSource } from '../src/adapters/content/hackmd.js';

describe('HackMdSource', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('imports only public published notes and sanitizes content', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/overview')) return Promise.resolve(Response.json({ notes: [{ id: 'one', title: 'Hello', tags: ['Writing'], lastchangeAt: '2026-01-03T12:00:00Z', publishType: 'view', publishedAt: '2026-01-02T00:00:00Z', permalink: 'hello' }, { id: 'draft', title: 'Draft', publishType: 'edit', publishedAt: '' }] }));
      return Promise.resolve(new Response('# Hello\n<script>x</script>'));
    }));
    await expect(new HackMdSource('writer').getPosts()).resolves.toEqual({ posts: [{ id: 'one', title: 'Hello', slug: 'hello', date: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-03T12:00:00.000Z', tags: ['Writing'], content: '&lt;script&gt;x&lt;/script&gt;' }] });
  });
  it('keeps same-day modifications, ignores earlier ones, and defaults missing tags', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/overview')
      ? Response.json({ notes: [
        { id: 'same-day', title: 'Same day', lastchangeAt: '2026-01-02T18:00:00Z', publishType: 'view', publishedAt: '2026-01-02T00:00:00Z', permalink: 'same-day' },
        { id: 'earlier', title: 'Earlier', tags: [], lastchangeAt: '2026-01-01T00:00:00Z', publishType: 'view', publishedAt: '2026-01-02T00:00:00Z', permalink: 'earlier' },
      ] })
      : new Response('body'))));
    const result = await new HackMdSource('writer').getPosts();
    expect(result.posts[0]).toMatchObject({ id: 'same-day', tags: [], updatedAt: '2026-01-02T18:00:00.000Z' });
    expect(result.posts[1]).toMatchObject({ id: 'earlier', tags: [] });
    expect(result.posts[1]).not.toHaveProperty('updatedAt');
  });
  it('rejects a non-empty invalid modified date without exposing article content', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/overview')
      ? Response.json({ notes: [{ id: 'one', title: 'Broken date', tags: [], lastchangeAt: 'not-a-date', publishType: 'view', publishedAt: '2026-01-02T00:00:00Z', permalink: 'broken-date' }] })
      : new Response('secret article body'))));
    await expect(new HackMdSource('writer').getPosts()).rejects.toThrow('HackMD note has an invalid modified date: Broken date');
    await expect(new HackMdSource('writer').getPosts()).rejects.not.toThrow('secret article body');
  });
  it('rejects empty publications and duplicate normalized slugs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ notes: [] }))));
    await expect(new HackMdSource('writer').getPosts()).rejects.toThrow('No public');
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/overview') ? Response.json({ notes: [{ id: '1', title: 'Same', publishType: 'view', publishedAt: '2026-01-02', permalink: 'same' }, { id: '2', title: 'Same', publishType: 'view', publishedAt: '2026-01-03', permalink: 'same' }] }) : new Response('text'))));
    await expect(new HackMdSource('writer').getPosts()).rejects.toThrow('Duplicate');
  });
});
