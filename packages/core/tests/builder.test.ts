import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBlog, buildFromVibelog, ContentSourceName, createDevBuilder, DEFAULT_DESIGN, HackMdSource, writeSourceSnapshot } from '../src/index.js';
import type { BlogDesignSpecV1, ContentSource } from '../src/index.js';

const roots: string[] = [];
const contentHash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
function jsonLd(html: string): Record<string, unknown> {
  const payload = /<script type="application\/ld\+json">([^]*?)<\/script>/u.exec(html)?.[1];
  if (!payload) throw new Error('Missing JSON-LD');
  return JSON.parse(payload) as Record<string, unknown>;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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
      site: { title: basename(root), description: 'Public notes', language: 'zh-Hant' },
      author: { name: 'Writer', bio: 'Public notes' },
      posts: [
        { title: 'Newer', slug: 'newer-post', description: 'private body two', publishedAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-03T00:00:00.000Z', included: true, tags: [{ name: '閱讀 筆記', slug: '閱讀-筆記' }, { name: 'AI', slug: 'ai' }], contentHash: contentHash('private body two') },
        { title: 'Older', slug: 'older-post', description: 'private body one', publishedAt: '2026-01-01T00:00:00.000Z', included: true, tags: [], contentHash: contentHash('private body one') },
      ],
      contentProfile: { postCount: 2, tagCount: 2, averageLength: 'short', codeUsage: 'none', imageUsage: 'none', mathUsage: 'none' },
    });
    expect(summary.posts.every((post) => !Object.hasOwn(post, 'content'))).toBe(true);
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
      { title: 'Two', slug: 'two', description: 'Two body', publishedAt: '2026-02-01T00:00:00.000Z', included: true, tags: [{ name: 'C#', slug: 'c-951a4d36' }], contentHash: contentHash('Two body') },
      { title: 'One', slug: 'one', description: 'One body', publishedAt: '2026-01-01T00:00:00.000Z', included: false, tags: [
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

  it('compiles one frozen source snapshot into three structurally different complete blogs', { timeout: 45_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-presentation-ir-')); roots.push(root);
    const builder = createDevBuilder({ root, contentSource: {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: 'Build once, present many ways.' }),
      getPosts: () => Promise.resolve({ posts: [
        { id: 'one', title: 'First', slug: 'first', date: '2026-01-03T00:00:00Z', tags: ['Design'], content: '## First section\n\nBody.\n\n## Second section\n\nMore.' },
        { id: 'two', title: 'Second', slug: 'second', date: '2026-01-02T00:00:00Z', tags: ['Design', 'Notes'], content: 'Second body.' },
        { id: 'three', title: 'Third', slug: 'third', date: '2026-01-01T00:00:00Z', tags: ['Notes'], content: 'Third body.' },
      ] }),
    } });
    await builder.prepare({ installDependencies: false });
    const summary = await builder.fetchContent();
    const sourceDir = join(root, 'source-snapshot');
    await writeSourceSnapshot(builder.vibelogDir, sourceDir, summary);

    const editorial = structuredClone(DEFAULT_DESIGN);
    editorial.theme.motif = 'editorial';
    editorial.chrome.header.variant = 'masthead';
    editorial.chrome.footer.variant = 'profile';
    editorial.pages.home.sections = [
      { type: 'intro', variant: 'centered', showAuthor: true },
      { type: 'featured-posts', variant: 'hero', count: 1 },
      { type: 'recent-posts', variant: 'grid', limit: 6, columns: 2 },
      { type: 'topics', variant: 'list', limit: 12 },
    ];
    editorial.pages.index = { layout: 'magazine', itemVariant: 'numbered', columns: 2, showDescription: true, showTags: true };
    editorial.pages.article = { layout: 'with-aside', header: 'editorial', toc: 'auto-aside', metadata: 'detailed', navigation: 'links', codeBlock: 'panel' };
    editorial.description = 'An editorial magazine layout.';

    const notebook = structuredClone(DEFAULT_DESIGN);
    notebook.theme.motif = 'notebook';
    notebook.pages.home.sections = [
      { type: 'author', variant: 'profile' },
      { type: 'recent-posts', variant: 'cards', limit: 5, columns: 2 },
      { type: 'topics', variant: 'cloud', limit: 12 },
    ];
    notebook.pages.index = { layout: 'grid', itemVariant: 'cards', columns: 2, showDescription: true, showTags: true };
    notebook.pages.article = { layout: 'wide', header: 'simple', toc: 'auto-inline', metadata: 'compact', navigation: 'cards', codeBlock: 'panel' };
    notebook.description = 'A personal notebook layout.';

    const fixtures: [string, BlogDesignSpecV1, string[]][] = [
      ['minimal', structuredClone(DEFAULT_DESIGN), ['home-hero variant-minimal', 'recent-posts variant-list']],
      ['editorial', editorial, ['site-header variant-masthead', 'featured-posts variant-hero', 'recent-posts variant-grid', 'home-topics variant-list']],
      ['notebook', notebook, ['home-author variant-profile', 'recent-posts variant-cards', 'home-topics variant-cloud']],
    ];
    const homes: string[] = [];
    for (const [name, design, signatures] of fixtures) {
      const workDir = join(root, `compile-${name}`);
      const outDir = join(workDir, 'dist');
      await buildBlog({ sourceDir, design, workDir, outDir, site: 'https://writer.example.com' });
      const home = await readFile(join(outDir, 'index.html'), 'utf8');
      homes.push(home);
      for (const signature of signatures) expect(home).toContain(signature);
      for (const path of ['blog/index.html', 'blog/first/index.html', 'tags/index.html', 'tags/design/index.html', 'search/index.html', 'rss.xml', 'sitemap-index.xml', 'robots.txt', 'llms.txt']) {
        await expect(stat(join(outDir, path))).resolves.toBeTruthy();
      }
      await expect(stat(join(outDir, 'pagefind', 'pagefind.js'))).resolves.toBeTruthy();
    }
    expect(new Set(homes).size).toBe(3);
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

    expect(JSON.parse(await readFile(join(root, '.vibelog', '.vibelog-state.json'), 'utf8'))).toEqual({ templateVersion: 12 });
    expect(await readFile(join(root, '.vibelog', 'src', 'styles', 'global.css'), 'utf8')).not.toContain('legacy custom copy');
  });

  it('builds the V12 reading experience with reliable descriptions, search, and machine-readable content', { timeout: 30_000 }, async () => {
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
            : number === 4
              ? `Body for article ${String(number)}.\n\n\`\`\`ts\nconst greeting = "hello";\n\`\`\`\n\n\`\`\`bash\nnpm run build\n\`\`\``
              : `Body for article ${String(number)}.`,
        description: number === 6 ? 'A **HackMD overview** summary with [readable text](https://example.com/private).' : undefined,
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
    const expectedDescription = 'A HackMD overview summary with readable text.';
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
    expect(home).toContain('<p class="site-description">Essays from Writer.</p>');
    expect(home).not.toContain('A short public author bio.');
    expect(home).not.toContain('class="author-bio"');
    expect(jsonLd(home)).toMatchObject({ '@type': 'Blog', name: 'Writer Journal', author: { name: 'Writer' } });
    expect(home).not.toContain('pagefind-component-ui.js');
    expect(home).toContain('href="/search"');
    expect(home).toContain('<nav aria-label="其他閱讀方式"><ul class="footer-links" role="list"><li><a href="/rss.xml">RSS</a></li><li><a href="/llms.txt">llms.txt</a></li></ul></nav>');
    expect(home).not.toContain('data-pagefind-body');
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
    expect(jsonLd(article)).toMatchObject({ '@type': 'BlogPosting', headline: 'Article 4', author: { name: 'Writer' }, datePublished: '2026-01-04T00:00:00.000Z', dateModified: '2026-01-08T12:00:00.000Z', keywords: ['Even', 'Writing'] });
    expect(article).not.toContain('pagefind-component-ui.js');
    expect(article).toContain('data-pagefind-body');
    expect(article).toContain('data-pagefind-meta="title"');
    expect(article).toMatch(/<pre class="astro-code[^"<]*"[^>]*data-language="ts"/u);
    expect(article).toMatch(/<pre class="astro-code[^"<]*"[^>]*data-language="bash"/u);
    expect(article).toContain('<link rel="stylesheet" href="/syntax.css">');
    expect(article).toMatch(/<span class="syntax-style-[a-f0-9]+"/u);
    expect(article).not.toMatch(/<span style="--shiki-/u);
    const syntaxCss = await readFile(join(output, 'syntax.css'), 'utf8');
    expect(syntaxCss).toContain('--shiki-light:');
    expect(syntaxCss).toContain('--shiki-dark:');
    expect(article).toContain('<link rel="alternate" type="text/markdown" href="https://writer.example.com/blog/article-4/index.md">');
    expect(article).toContain('<link rel="describedby" href="https://writer.example.com/llms.txt">');
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
    expect(sitemap).not.toContain('https://writer.example.com/search/');
    expect(sitemap).not.toContain('.md');
    const search = await readFile(join(output, 'search', 'index.html'), 'utf8');
    expect(search).toContain('<meta name="robots" content="noindex, follow">');
    expect(search).toContain('/pagefind/pagefind-component-ui.js');
    expect(search).toContain('<pagefind-input');
    expect(search).toContain('<pagefind-results');
    expect(search).not.toContain('data-pagefind-body');
    expect(await stat(join(output, 'pagefind', 'pagefind.js'))).toBeTruthy();
    expect(await stat(join(output, 'pagefind', 'pagefind-component-ui.js'))).toBeTruthy();
    expect(await stat(join(output, 'pagefind', 'pagefind-component-ui.css'))).toBeTruthy();
    const markdown = await readFile(join(output, 'blog', 'article-4', 'index.md'), 'utf8');
    expect(markdown).toContain('# Article 4\n\nPublished: 2026-01-04\nUpdated: 2026-01-08\nCanonical: https://writer.example.com/blog/article-4/');
    expect(markdown).toContain('Body for article 4.');
    expect(markdown).not.toContain('article-navigation');
    const llms = await readFile(join(output, 'llms.txt'), 'utf8');
    expect(llms).toContain('# Writer Journal\n\n> Essays from Writer.\n\n## Posts');
    expect(llms).toContain('https://writer.example.com/blog/article-4/index.md');
    expect(llms).toContain(expectedDescription);
    expect(llms.indexOf('Article 6')).toBeLessThan(llms.indexOf('Article 1'));
    const robots = await readFile(join(output, 'robots.txt'), 'utf8');
    expect(robots).toBe('User-agent: *\nAllow: /\n\nSitemap: https://writer.example.com/sitemap-index.xml\n');
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
    expect(await readdir(join(output, 'blog'))).not.toContain('2');
  });

  it('paginates only the post archive at 10 posts and removes stale pages on rebuild', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-pagination-')); roots.push(root);
    let count = 11;
    const source: ContentSource = {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: '' }),
      getPosts: () => Promise.resolve({ posts: Array.from({ length: count }, (_, index) => ({
        id: `post-${String(index + 1)}`,
        title: `Post ${String(index + 1)}`,
        slug: `post-${String(index + 1)}`,
        date: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        content: `Unique body ${String(index + 1)}`,
      })) }),
    };
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });
    const output = join(root, 'public');
    await builder.fetchContent();
    await buildFromVibelog({ vibelogDir: join(root, '.vibelog'), outDir: output, site: 'https://writer.example.com' });

    const first = await readFile(join(output, 'blog', 'index.html'), 'utf8');
    const second = await readFile(join(output, 'blog', '2', 'index.html'), 'utf8');
    expect(first).toContain('Post 11');
    expect(first).not.toContain('Post 1</');
    expect(first).toContain('href="/blog/2/"');
    expect(first).toContain('<link rel="canonical" href="https://writer.example.com/blog/">');
    expect(second).toContain('Post 1');
    expect(second).not.toContain('Post 11');
    expect(second).toContain('href="/blog/"');
    expect(second).toContain('<link rel="canonical" href="https://writer.example.com/blog/2/">');
    expect(await readdir(join(output, 'blog'))).not.toContain('1');

    count = 10;
    await builder.fetchContent();
    await buildFromVibelog({ vibelogDir: join(root, '.vibelog'), outDir: output, site: 'https://writer.example.com' });
    const ten = await readFile(join(output, 'blog', 'index.html'), 'utf8');
    expect(ten).toContain('Post 1');
    expect(ten).not.toContain('Post 11');
    expect(ten).not.toContain('archive-pagination');
    expect(await readdir(join(output, 'blog'))).not.toContain('2');
  });

  it('keeps hostile article titles inside safely serialized JSON-LD', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-jsonld-')); roots.push(root);
    const title = 'An article </script><script>alert(1)</script>';
    const source: ContentSource = {
      name: ContentSourceName.HACKMD,
      getAuthor: () => Promise.resolve({ name: 'Writer', bio: '' }),
      getPosts: () => Promise.resolve({ posts: [{ id: 'post', title, slug: 'post', date: '2026-01-01T00:00:00Z', content: 'Body.' }] }),
    };
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });
    await builder.fetchContent();
    const output = join(root, 'public');
    await buildFromVibelog({ vibelogDir: join(root, '.vibelog'), outDir: output, site: 'https://writer.example.com' });
    const article = await readFile(join(output, 'blog', 'post', 'index.html'), 'utf8');
    expect(jsonLd(article).headline).toBe(title);
    expect(/<script type="application\/ld\+json">([^]*?)<\/script>/u.exec(article)?.[1]).not.toContain('<');
    expect(article).toContain('\\u003c/script>');
    const markdown = await readFile(join(output, 'blog', 'post', 'index.md'), 'utf8');
    expect(markdown).toContain('Canonical: https://writer.example.com/blog/post/');
  });

  it('renders common HackMD Markdown without adding client scripts', { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'vibelog-builder-hackmd-markdown-')); roots.push(root);
    const content = await readFile(join(import.meta.dirname, 'fixtures', 'content', 'hackmd-compatibility.md'), 'utf8');
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/info/@writer')) return Promise.resolve(Response.json({ user: { displayName: 'Writer', biography: '' } }));
      if (url.endsWith('/api/@writer/overview')) return Promise.resolve(Response.json({ notes: [{
        id: 'compatibility',
        title: 'HackMD compatibility',
        content: 'Overview summary from HackMD.',
        tags: [],
        lastchangeAt: '',
        publishType: 'view',
        publishedAt: '2026-01-01T00:00:00Z',
        permalink: 'compatibility',
      }] }));
      if (url.endsWith('/compatibility/download')) return Promise.resolve(new Response(content));
      return Promise.resolve(new Response(null, { status: 404 }));
    }));
    const source = new HackMdSource('writer', { baseUrl: 'http://fixture.test' });
    const builder = createDevBuilder({ root, contentSource: source });
    await builder.prepare({ installDependencies: false });
    await builder.fetchContent();
    const output = join(root, 'public');

    await buildFromVibelog({ vibelogDir: join(root, '.vibelog'), outDir: output, site: 'https://writer.example.com' });

    const article = await readFile(join(output, 'blog', 'compatibility', 'index.html'), 'utf8');
    for (const type of ['info', 'success', 'warning', 'danger', 'note', 'tip', 'important', 'caution']) {
      expect(article).toContain(`callout-${type}`);
    }
    expect(article).toContain('<aside aria-label="Background" class="callout callout-info">');
    expect(article).toContain('<details class="spoiler"><summary class="spoiler-title">Show the answer</summary>');
    expect(article).toContain('<details class="spoiler"><summary class="spoiler-title">Terminal output</summary>');
    expect(article).toMatch(/<details class="spoiler" open(?:="")?><summary class="spoiler-title">Open details<\/summary>/u);
    expect(article).not.toContain('class="ignored"');
    expect(article).toContain('<mark>important</mark>');
    expect(article).toContain('<ins>new</ins>');
    expect(article).toContain('H<sub>2</sub>O');
    expect(article).toContain('x<sup>2</sup>');
    expect(article).toContain('<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>');
    expect(article).toContain('class="contains-task-list"');
    expect(article).toContain('data-footnotes');
    expect(article).toContain('<dl>');
    expect(article).toContain('<dt>Term</dt>');
    expect(article).toMatch(/<dd>A concise definition\.\s*<\/dd>/u);
    expect(article).toContain('✨');
    expect(article).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
    expect(article).toContain('class="katex-error"');
    expect(article).toContain('data-language="javascript"');
    expect(article).toContain('data-line-start="1"');
    expect(article).toContain('data-line-start="3"');
    expect(article).toContain('data-line-start="10"');
    expect(article).toContain('data-line-number="10"');
    expect(article).toContain('class="line highlighted"');
    expect(article).toContain('data-language="text"');
    expect(article).toMatch(/<pre class="astro-code[^"<]*wrap-code/u);
    expect(article).toContain(':::warning');
    expect(article).toContain('<blockquote>\n<p>A regular blockquote stays a blockquote.</p>');
    expect(article).toContain('Keep an inline [TOC] reference visible.');
    expect(article).not.toMatch(/<p>\[TOC\]<\/p>/u);
    expect(article).toContain('Custom heading');
    expect(article).toContain('Unknown directives keep their content.');
    expect(article).not.toContain('custom-element');
    expect(article).not.toContain('<script>alert');
    expect(article).toContain('about:blank#blocked-');
    expect(article).not.toContain('pagefind-component-ui.js');
    expect(jsonLd(article)).toMatchObject({ '@type': 'BlogPosting', headline: 'HackMD compatibility' });
    expect(article).toContain('<meta name="description" content="Overview summary from HackMD.">');
  });
});
