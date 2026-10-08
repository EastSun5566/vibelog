import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildBlog, compileDesignCss, ContentSourceName, createDevBuilder, DEFAULT_DESIGN_V2, validateBlogDesignSpecV2, writeSourceSnapshot } from '@vibelog/core';
import { migratePersistedDesignToV2 } from '@vibelog/core/migration-v1';

const design = validateBlogDesignSpecV2(structuredClone(DEFAULT_DESIGN_V2));
assert(compileDesignCss(design).includes('--'));
assert.equal(typeof migratePersistedDesignToV2, 'function');
const builder = createDevBuilder({
  root: join(process.cwd(), 'blog'),
  contentSource: {
    name: ContentSourceName.HACKMD,
    getAuthor: () => Promise.resolve({ name: 'Package Writer', bio: 'A synthetic blog.' }),
    getPosts: () => Promise.resolve({ posts: [{
      id: 'pack-post', title: 'Standalone package', slug: 'standalone-package',
      date: '2026-01-01T00:00:00Z', tags: ['Packages'], description: 'Synthetic package summary.',
      content: '## Package smoke\n\nSearchable package content.\n\nInline $E=mc^2$.\n\n$$\nE=mc^2\n$$\n\n```math\nE=mc^2\n```\n\nInvalid $\\broken{$.\n\n$\\href{javascript:alert(1)}{probe}$\n\n$\\includegraphics{https://example.com/probe.png}$',
    }] }),
  },
});
await builder.prepare({ installDependencies: false });
const summary = await builder.fetchContent();
const sourceDir = join(process.cwd(), 'source');
await writeSourceSnapshot(builder.vibelogDir, sourceDir, summary);
const workDir = join(process.cwd(), 'compiled');
const outDir = join(workDir, 'dist');
await buildBlog({ sourceDir, design, workDir, outDir, site: 'https://package.example.com' });
for (const path of ['index.html', 'blog/index.html', 'blog/standalone-package/index.html', 'search/index.html', 'rss.xml', 'sitemap-index.xml', 'sitemap-0.xml', 'blog/standalone-package/index.md', 'llms.txt', 'robots.txt', 'pagefind/pagefind.js']) {
  assert((await readFile(join(outDir, path))).length > 0, `Missing or empty ${path}`);
}
assert((await readdir(join(outDir, 'pagefind'), { recursive: true })).some((name) => name.endsWith('.pf_index')));
const article = await readFile(join(outDir, 'blog/standalone-package/index.html'), 'utf8');
assert(article.includes('data-pagefind-body'));
assert(article.includes('<math'));
assert(article.includes('katex-error'));
assert(!article.includes('href="javascript:'));
assert(!article.includes('src="https://example.com/probe.png"'));
assert((await readFile(join(outDir, 'llms.txt'), 'utf8')).includes('https://package.example.com/blog/standalone-package/index.md'));
assert((await readFile(join(outDir, 'rss.xml'), 'utf8')).includes('Standalone package'));
console.log('Standalone imports, IR/CSS and complete static blog build passed.');
