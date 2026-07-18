import { afterEach, describe, expect, it, vi } from 'vitest';
import { HackMdSource } from '../src/adapters/content/hackmd.js';

describe('HackMdSource', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('imports only public published notes and sanitizes content', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/overview')) return Promise.resolve(Response.json({ notes: [{ id: 'one', title: 'Hello', publishType: 'view', publishedAt: '2026-01-02T00:00:00Z', permalink: 'hello' }, { id: 'draft', title: 'Draft', publishType: 'edit', publishedAt: '' }] }));
      return Promise.resolve(new Response('# Hello\n<script>x</script>'));
    }));
    await expect(new HackMdSource('writer').getPosts()).resolves.toEqual({ posts: [{ id: 'one', title: 'Hello', slug: 'hello', date: '2026-01-02T00:00:00.000Z', content: '&lt;script&gt;x&lt;/script&gt;' }] });
  });
  it('rejects empty publications and duplicate normalized slugs', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ notes: [] }))));
    await expect(new HackMdSource('writer').getPosts()).rejects.toThrow('No public');
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/overview') ? Response.json({ notes: [{ id: '1', title: 'Same', publishType: 'view', publishedAt: '2026-01-02', permalink: 'same' }, { id: '2', title: 'Same', publishType: 'view', publishedAt: '2026-01-03', permalink: 'same' }] }) : new Response('text'))));
    await expect(new HackMdSource('writer').getPosts()).rejects.toThrow('Duplicate');
  });
});
