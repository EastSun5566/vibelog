import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFromVibelog, ContentSourceName, createDevBuilder } from '../src/index.js';
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

  it('replaces repository-owned CSS when upgrading a V1 draft', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-upgrade-')); roots.push(root);
    const source: ContentSource = {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: 'Public notes' }),
      getPosts: () => Promise.resolve({ posts: [
        { id: 'one', title: 'One', slug: 'one', date: '2026-01-01T00:00:00Z', content: 'One body' },
      ] }),
    };
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });
    await writeFile(join(root, '.vibelog', '.vibelog-state.json'), JSON.stringify({ templateVersion: 1 }));
    await writeFile(join(root, '.vibelog', 'src', 'styles', 'global.css'), '/* legacy custom copy */');

    await builder.prepare({ installDependencies: false });

    expect(JSON.parse(await readFile(join(root, '.vibelog', '.vibelog-state.json'), 'utf8'))).toEqual({ templateVersion: 2 });
    expect(await readFile(join(root, '.vibelog', 'src', 'styles', 'global.css'), 'utf8')).not.toContain('legacy custom copy');
  });

  it('builds the V2 reading experience, metadata, feeds, and post navigation', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-public-')); roots.push(root);
    const posts = Array.from({ length: 6 }, (_, index) => {
      const number = index + 1;
      return {
        id: `article-${String(number)}`,
        title: `Article ${String(number)}`,
        slug: `article-${String(number)}`,
        date: `2026-01-0${String(number)}T00:00:00Z`,
        content: `Body for article ${String(number)}.`,
      };
    });
    const source: ContentSource = {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: 'A short public author bio.' }),
      getPosts: () => Promise.resolve({ posts }),
    };
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });
    await writeFile(join(root, 'vibelog.config.json'), JSON.stringify({
      site: { title: 'Writer Journal', description: 'Essays from Writer.', language: 'zh-Hant' },
    }));
    await builder.fetchContent();

    const output = join(root, 'public');
    await buildFromVibelog({
      vibelogDir: join(root, '.vibelog'),
      outDir: output,
      site: 'https://writer.example.com',
    });

    const home = await readFile(join(output, 'index.html'), 'utf8');
    expect(home).toContain('<h1 id="site-heading">Writer Journal</h1>');
    expect(home).toContain('A short public author bio.');
    expect(home).not.toContain('<script');
    for (const number of [6, 5, 4, 3, 2]) expect(home).toContain(`Article ${String(number)}`);
    expect(home).not.toContain('Article 1');

    const archive = await readFile(join(output, 'blog', 'index.html'), 'utf8');
    for (const number of [6, 5, 4, 3, 2, 1]) expect(archive).toContain(`Article ${String(number)}`);
    expect(archive.indexOf('Article 6')).toBeLessThan(archive.indexOf('Article 5'));
    expect(archive.indexOf('Article 2')).toBeLessThan(archive.indexOf('Article 1'));

    const article = await readFile(join(output, 'blog', 'article-4', 'index.html'), 'utf8');
    expect(article).toContain('<title>Article 4 · Writer Journal</title>');
    expect(article).toContain('<meta property="og:type" content="article">');
    expect(article).toContain('<meta property="article:published_time" content="2026-01-04T00:00:00.000Z">');
    expect(article).toContain('<link rel="canonical" href="https://writer.example.com/blog/article-4/">');
    expect(article).toContain('較新文章');
    expect(article).toContain('Article 5');
    expect(article).toContain('較舊文章');
    expect(article).toContain('Article 3');
    expect(article).not.toContain('<script');

    const feed = await readFile(join(output, 'rss.xml'), 'utf8');
    expect(feed).toContain('<pubDate>Tue, 06 Jan 2026 00:00:00 GMT</pubDate>');
    expect(feed.indexOf('Article 6')).toBeLessThan(feed.indexOf('Article 5'));
    const sitemap = await readFile(join(output, 'sitemap-0.xml'), 'utf8');
    expect(sitemap).toContain('https://writer.example.com/blog/article-1/');
    expect(sitemap).toContain('https://writer.example.com/blog/article-6/');
  });
});
