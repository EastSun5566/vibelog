import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFromVibelog, ContentSourceName, createDevBuilder } from '../src/index.js';
import type { ContentSource } from '../src/index.js';

const roots: string[] = [];
const contentHash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('DevBuilder content summary', () => {
  it('returns normalized metadata without article bodies and reads the source once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-')); roots.push(root);
    const getAuthor = vi.fn(() => Promise.resolve({ name: 'Writer', bio: 'Public notes' }));
    const getPosts = vi.fn(() => Promise.resolve({ posts: [
      { id: 'older', title: 'Older', slug: 'Older Post', date: '2026-01-01T00:00:00Z', content: 'private body one' },
      { id: 'newer', title: 'Newer', slug: 'Newer Post', date: '2026-02-01T00:00:00Z', updatedAt: '2026-02-03T00:00:00Z', tags: [' ＡＩ ', 'ai', '閱讀   筆記'], content: 'private body two' },
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
        { title: 'Newer', slug: 'newer-post', publishedAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-03T00:00:00.000Z', included: true, tags: [{ name: '閱讀 筆記', slug: '閱讀-筆記' }, { name: 'AI', slug: 'ai' }], contentHash: contentHash('private body two') },
        { title: 'Older', slug: 'older-post', publishedAt: '2026-01-01T00:00:00.000Z', included: true, tags: [], contentHash: contentHash('private body one') },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain('private body');
    expect(summary.posts.every((post) => !Object.hasOwn(post, 'description'))).toBe(true);
  });

  it('writes only selected posts while retaining the full manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-selection-')); roots.push(root);
    const source: ContentSource = {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: 'Public notes' }),
      getPosts: () => Promise.resolve({ posts: [
        { id: 'one', title: 'One', slug: 'one', date: '2026-01-01T00:00:00Z', tags: ['C++', '😀'], content: 'One body' },
        { id: 'two', title: 'Two', slug: 'two', date: '2026-02-01T00:00:00Z', tags: ['C#'], content: 'Two body' },
      ] }),
    };
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });

    const summary = await builder.fetchContent({ excludedSlugs: ['one'] });

    expect(summary.posts).toEqual([
      { title: 'Two', slug: 'two', publishedAt: '2026-02-01T00:00:00.000Z', included: true, tags: [{ name: 'C#', slug: 'c-951a4d36' }], contentHash: contentHash('Two body') },
      { title: 'One', slug: 'one', publishedAt: '2026-01-01T00:00:00.000Z', included: false, tags: [
        { name: '😀', slug: 'tag-f0443a34' },
        { name: 'C++', slug: 'c-cedb1bac' },
      ], contentHash: contentHash('One body') },
    ]);
    expect(await readdir(join(root, '.vibelog', 'src', 'content', 'blog'))).toEqual(['two.md']);
    const generatedPost = matter(await readFile(join(root, '.vibelog', 'src', 'content', 'blog', 'two.md'), 'utf8'));
    expect(generatedPost.data).not.toHaveProperty('contentHash');
    await expect(builder.fetchContent({ excludedSlugs: ['one', 'two'] })).rejects.toThrow('No articles selected');
  });

  it('hashes only exact Markdown content, independently of title and tags', async () => {
    const rootsForHashes = await Promise.all(['one', 'two', 'three'].map(async (name) => {
      const root = await mkdtemp(join(tmpdir(), `vibelog-builder-hash-${name}-`)); roots.push(root); return root;
    }));
    const inputs = [
      { title: 'First title', tags: ['One'], content: 'Same Markdown' },
      { title: 'Changed title', tags: ['Different'], content: 'Same Markdown' },
      { title: 'First title', tags: ['One'], content: 'Changed Markdown' },
    ];
    const hashes: (string | undefined)[] = [];
    for (const [index, root] of rootsForHashes.entries()) {
      const input = inputs[index];
      if (!input) throw new Error('Missing hash fixture');
      const builder = createDevBuilder({ root, contentSource: {
        name: ContentSourceName.HACKMD,
        getAuthor: () => Promise.resolve({ name: 'Writer', bio: '' }),
        getPosts: () => Promise.resolve({ posts: [{ id: 'one', slug: 'one', date: '2026-01-01T00:00:00Z', ...input }] }),
      } });
      await builder.prepare({ installDependencies: false });
      hashes.push((await builder.fetchContent()).posts[0]?.contentHash);
    }
    expect(hashes[0]).toBe(contentHash('Same Markdown'));
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });

  it('replaces repository-owned CSS when upgrading an older draft', async () => {
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
    await writeFile(join(root, '.vibelog', '.vibelog-state.json'), JSON.stringify({ templateVersion: 2 }));
    await writeFile(join(root, '.vibelog', 'src', 'styles', 'global.css'), '/* legacy custom copy */');

    await builder.prepare({ installDependencies: false });

    expect(JSON.parse(await readFile(join(root, '.vibelog', '.vibelog-state.json'), 'utf8'))).toEqual({ templateVersion: 5 });
    expect(await readFile(join(root, '.vibelog', 'src', 'styles', 'global.css'), 'utf8')).not.toContain('legacy custom copy');
  });

  it('builds the V5 reading experience with reliable descriptions and long-form navigation', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-public-')); roots.push(root);
    const posts = Array.from({ length: 6 }, (_, index) => {
      const number = index + 1;
      return {
        id: `article-${String(number)}`,
        title: `Article ${String(number)}`,
        slug: `article-${String(number)}`,
        date: `2026-01-0${String(number)}T00:00:00Z`,
        updatedAt: number === 4 ? '2026-01-08T12:00:00Z' : number === 5 ? '2026-01-05T12:00:00Z' : undefined,
        tags: number <= 3 ? ['Notes'] : ['Writing', number % 2 === 0 ? 'Even' : 'Odd'],
        content: number === 6
          ? `![Private image](https://images.example.com/private.png)\n\n# Ignored heading\n\n### Preface details\n\nA **reliable** summary with [readable text](https://example.com/hidden) and \`code\`.\n\n## Main section\n\nBody for article ${String(number)}.\n\n### Implementation details\n\nMore details.\n\n#### Ignored nested heading\n\nClosing note.`
          : number === 5
            ? `Body for article ${String(number)}.\n\n## Only section\n\nA single section does not need a table of contents.`
            : `Body for article ${String(number)}.`,
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

    const generatedPost = matter(await readFile(join(root, '.vibelog', 'src', 'content', 'blog', 'article-6.md'), 'utf8'));
    const expectedDescription = 'A reliable summary with readable text and code.';
    expect(generatedPost.data.description).toBe(expectedDescription);
    expect(generatedPost.data.description).not.toMatch(/https?:|[*`![\]]/u);
    expect(generatedPost.content).toContain('https://images.example.com/private.png');

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
    expect(home).toContain(expectedDescription);
    expect(home).not.toContain('images.example.com');

    const archive = await readFile(join(output, 'blog', 'index.html'), 'utf8');
    for (const number of [6, 5, 4, 3, 2, 1]) expect(archive).toContain(`Article ${String(number)}`);
    expect(archive.indexOf('Article 6')).toBeLessThan(archive.indexOf('Article 5'));
    expect(archive.indexOf('Article 2')).toBeLessThan(archive.indexOf('Article 1'));
    expect(archive).toContain('Writing');
    expect(archive).toContain(expectedDescription);

    const article = await readFile(join(output, 'blog', 'article-4', 'index.html'), 'utf8');
    expect(article).toContain('<title>Article 4 · Writer Journal</title>');
    expect(article).toContain('<meta property="og:type" content="article">');
    expect(article).toContain('<meta property="article:published_time" content="2026-01-04T00:00:00.000Z">');
    expect(article).toContain('<meta property="article:modified_time" content="2026-01-08T12:00:00.000Z">');
    expect(article).toContain('<meta property="article:tag" content="Even">');
    expect(article).toContain('<meta property="article:tag" content="Writing">');
    expect(article).toContain('更新於');
    expect(article).toContain('<link rel="canonical" href="https://writer.example.com/blog/article-4/">');
    expect(article).toContain('較新文章');
    expect(article).toContain('Article 5');
    expect(article).toContain('較舊文章');
    expect(article).toContain('Article 3');
    expect(article).not.toContain('blog-item-description');
    expect(article).not.toContain('<script');
    const sameDayArticle = await readFile(join(output, 'blog', 'article-5', 'index.html'), 'utf8');
    expect(sameDayArticle).toContain('<meta property="article:modified_time" content="2026-01-05T12:00:00.000Z">');
    expect(sameDayArticle).not.toContain('更新於');

    const tagIndex = await readFile(join(output, 'tags', 'index.html'), 'utf8');
    expect(tagIndex).toContain('<title>主題 · Writer Journal</title>');
    expect(tagIndex.indexOf('Notes')).toBeLessThan(tagIndex.indexOf('Writing'));
    expect(tagIndex).toContain('3 篇');
    const writingTag = await readFile(join(output, 'tags', 'writing', 'index.html'), 'utf8');
    expect(writingTag).toContain('<title>主題：Writing · Writer Journal</title>');
    expect(writingTag.indexOf('Article 6')).toBeLessThan(writingTag.indexOf('Article 5'));
    expect(writingTag).not.toContain('Article 3');
    expect(writingTag).toContain(expectedDescription);

    const feed = await readFile(join(output, 'rss.xml'), 'utf8');
    expect(feed).toContain('<pubDate>Tue, 06 Jan 2026 00:00:00 GMT</pubDate>');
    expect(feed).toContain('<category>Writing</category>');
    expect(feed).toContain(`<description>${expectedDescription}</description>`);
    expect(feed).not.toContain('images.example.com');
    const summarizedArticle = await readFile(join(output, 'blog', 'article-6', 'index.html'), 'utf8');
    expect(summarizedArticle).toContain(`<meta name="description" content="${expectedDescription}">`);
    expect(summarizedArticle).toContain(`<meta property="og:description" content="${expectedDescription}">`);
    expect(summarizedArticle).toContain(`<meta name="twitter:description" content="${expectedDescription}">`);
    expect(summarizedArticle).not.toContain('class="blog-item-description"');
    const tableOfContents = /<nav class="table-of-contents" aria-label="文章目錄">[\s\S]*?<\/nav>/u.exec(summarizedArticle)?.[0];
    expect(tableOfContents).toBeDefined();
    expect(summarizedArticle.match(/aria-label="文章目錄"/gu)).toHaveLength(1);
    expect(tableOfContents).toContain('<details open>');
    expect(tableOfContents).toContain('href="#preface-details"');
    expect(tableOfContents).toContain('href="#main-section"');
    expect(tableOfContents).toContain('href="#implementation-details"');
    expect(tableOfContents).not.toContain('Ignored heading');
    expect(tableOfContents).not.toContain('Ignored nested heading');
    expect(tableOfContents).toMatch(/href="#main-section"[^]*<ol>[^]*href="#implementation-details"/u);
    expect(summarizedArticle).toContain('id="preface-details"');
    expect(summarizedArticle).toContain('id="main-section"');
    expect(summarizedArticle).toContain('id="implementation-details"');
    expect(summarizedArticle).toContain('<a class="article-back-to-start" href="#article-start">回到文章開頭</a>');
    const singleHeadingArticle = await readFile(join(output, 'blog', 'article-5', 'index.html'), 'utf8');
    expect(singleHeadingArticle).toContain('id="only-section"');
    expect(singleHeadingArticle).not.toContain('aria-label="文章目錄"');
    expect(singleHeadingArticle).not.toContain('article-back-to-start');
    expect(feed.indexOf('Article 6')).toBeLessThan(feed.indexOf('Article 5'));
    const sitemap = await readFile(join(output, 'sitemap-0.xml'), 'utf8');
    expect(sitemap).toContain('https://writer.example.com/blog/article-1/');
    expect(sitemap).toContain('https://writer.example.com/blog/article-6/');
    expect(sitemap).toContain('https://writer.example.com/tags/writing/');
  });

  it('builds an empty tag index when no posts have tags', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-no-tags-')); roots.push(root);
    const source: ContentSource = {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: '' }),
      getPosts: () => Promise.resolve({ posts: [
        { id: 'one', title: 'One', slug: 'one', date: '2026-01-01T00:00:00Z', content: 'One body' },
      ] }),
    };
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });
    await builder.fetchContent();
    const output = join(root, 'public');
    await buildFromVibelog({ vibelogDir: join(root, '.vibelog'), outDir: output, site: 'https://writer.example.com' });
    const home = await readFile(join(output, 'index.html'), 'utf8');
    const tagIndex = await readFile(join(output, 'tags', 'index.html'), 'utf8');
    expect(home).not.toContain('>主題</a>');
    expect(tagIndex).toContain('目前沒有文章主題。');
  });
});
