import { describe, expect, it } from 'vitest';
import { createContentProfile } from '../src/index.js';
import {
  DEFAULT_DESIGN,
  DEFAULT_THEME,
  migrateThemeConfigToDesign,
  normalizeDesignDecoration,
  parsePersistedDesign,
  renderDesignCss,
  validateBlogDesignSpec,
} from '../src/migration-v1.js';
import type { BlogDesignSpecV1 } from '../src/migration-v1.js';
import type { Post } from '../src/index.js';

function design(update: (value: BlogDesignSpecV1) => void): BlogDesignSpecV1 {
  const value = structuredClone(DEFAULT_DESIGN);
  update(value);
  return value;
}

describe('Presentation IR v1', () => {
  it('accepts one complete versioned design and compiles only known semantic targets', () => {
    const value = design((candidate) => {
      candidate.styles.rules = [{ target: 'home.intro', declarations: { textAlign: 'center', paddingBlock: 'xl', width: 'reading' } }];
    });
    expect(validateBlogDesignSpec(value)).toEqual(value);
    const css = renderDesignCss(value);
    expect(css).toContain('[data-design-target="home.intro"]{text-align:center;padding-block:2.5rem;max-width:42rem}');
    expect(css).not.toContain('javascript:');
  });

  it('scopes list and code styles to the variants rendered by each component', () => {
    const value = design((candidate) => {
      candidate.theme.motif = 'editorial';
      candidate.pages.index.itemVariant = 'numbered';
      candidate.pages.article.codeBlock = 'panel';
    });
    const css = renderDesignCss(value);
    expect(css).toContain('.blog-list.variant-numbered .blog-list-item');
    expect(css).toContain('.blog-list.variant-cards .blog-list-item');
    expect(css).toContain('.blog-post.code-panel .prose pre');
    expect(css).not.toMatch(/(?:^|\n)\.blog-list-item\s*\{/u);
    expect(css).not.toMatch(/(?:^|\n)\.prose pre\s*\{/u);
  });

  it('keeps one boundary treatment per region in new and saved designs', () => {
    const value = design((candidate) => {
      candidate.theme.motif = 'notebook';
      candidate.chrome.header.variant = 'masthead';
      candidate.pages.article.header = 'editorial';
      candidate.styles.rules = [
        { target: 'posts.items', declarations: { border: 'hairline', surface: 'surface', gap: 'md' } },
        { target: 'site.header', declarations: { border: 'strong', gap: 'sm' } },
        { target: 'article.header', declarations: { border: 'hairline' } },
        { target: 'article.toc', declarations: { border: 'strong', surface: 'surface', paddingBlock: 'md' } },
        { target: 'site.footer', declarations: { border: 'hairline', gap: 'sm' } },
      ];
    });
    expect(validateBlogDesignSpec(value)).toEqual(value);
    const original = structuredClone(value);
    const normalized = normalizeDesignDecoration(value);
    expect(normalizeDesignDecoration(normalized)).toEqual(normalized);
    expect(value).toEqual(original);
    expect(normalized.styles.rules).toEqual([
      { target: 'posts.items', declarations: { gap: 'md' } },
      { target: 'site.header', declarations: { gap: 'sm' } },
      { target: 'article.toc', declarations: { paddingBlock: 'md' } },
      { target: 'site.footer', declarations: { gap: 'sm' } },
    ]);
    const css = renderDesignCss(value);
    expect(css).toContain('[data-design-target="posts.items"]{gap:1rem}');
    expect(css).not.toContain('[data-design-target="posts.items"]{border:');
    expect(css).toContain('.blog-list.variant-divided .blog-list-item+.blog-list-item{border-top:1px solid color-mix(');
    expect(css).not.toContain('.blog-list.variant-divided .blog-list-item:first-child{border-top:');
    expect(css).toContain('.blog-list.variant-cards .blog-list-item{background:var(--theme-surface);border:1px solid color-mix(');
    expect(css).toContain('[data-design-target="article.toc"]{padding-block:1rem}');
    expect(css).toContain('[data-design-target="site.footer"]{gap:0.5rem}');
    expect(css).not.toContain('[data-design-target="article.toc"]{border:');
    expect(css).not.toContain('[data-design-target="site.footer"]{border:');
    expect(css).toContain('body.page-home{background-image:linear-gradient(to bottom,transparent 18rem,var(--theme-background) 36rem)');
    expect(css).toContain('color-mix(in srgb,var(--theme-border) 15%,transparent)');
    expect(css).not.toContain('body{background-image:');
  });

  it.each([
    ['missing version', (() => { const { version: _version, ...value } = DEFAULT_DESIGN; return value; })()],
    ['unknown field', { ...DEFAULT_DESIGN, html: '<script>bad</script>' }],
    ['invalid enum', design((value) => { (value.theme as { motif: string }).motif = 'magazine'; })],
    ['bad color', design((value) => { value.theme.colors.accent = 'url(https://example.com/x)'; })],
    ['text contrast', design((value) => { value.theme.colors.text = '#ffffff'; })],
    ['accent contrast', design((value) => { value.theme.colors.accent = '#ffffff'; })],
    ['duplicate sections', design((value) => { value.pages.home.sections.push({ type: 'intro', variant: 'minimal', showAuthor: true }); })],
    ['missing posts section', design((value) => { value.pages.home.sections = [{ type: 'intro', variant: 'minimal', showAuthor: true }]; })],
    ['too many sections', design((value) => { value.pages.home.sections = [
      { type: 'intro', variant: 'minimal', showAuthor: true },
      { type: 'featured-posts', variant: 'hero', count: 1 },
      { type: 'recent-posts', variant: 'grid', limit: 6, columns: 2 },
      { type: 'topics', variant: 'list', limit: 12 },
      { type: 'author', variant: 'compact' },
      { type: 'author', variant: 'profile' },
    ]; })],
    ['invalid recent columns', design((value) => { value.pages.home.sections = [{ type: 'recent-posts', variant: 'grid', limit: 6, columns: 1 }]; })],
    ['invalid index columns', design((value) => { value.pages.index = { ...value.pages.index, layout: 'grid', columns: 1 }; })],
    ['invalid aside TOC', design((value) => { value.pages.article.toc = 'auto-aside'; })],
    ['duplicate style targets', design((value) => { value.styles.rules = [
      { target: 'site.header', declarations: { gap: 'sm' } },
      { target: 'site.header', declarations: { gap: 'lg' } },
    ]; })],
    ['too many style rules', design((value) => { value.styles.rules = Array.from({ length: 9 }, (_, index) => ({ target: 'site.header', declarations: { gap: index % 2 ? 'sm' : 'md' } })); })],
    ['raw CSS declaration', design((value) => { (value.styles.rules as unknown[]) = [{ target: 'article.prose', declarations: { css: 'position:fixed' } }]; })],
    ['raw URL', design((value) => { (value.chrome.header as Record<string, unknown>).url = 'https://example.com'; })],
  ])('rejects %s', (_name, value) => {
    expect(() => validateBlogDesignSpec(value)).toThrow();
  });

  it.each(['minimal', 'editorial', 'notebook'] as const)('migrates the legacy %s preset explicitly', (preset) => {
    const migrated = migrateThemeConfigToDesign({ ...DEFAULT_THEME, preset });
    expect(validateBlogDesignSpec(migrated)).toEqual(migrated);
    expect(migrated.version).toBe(1);
    expect(migrated.theme.motif).toBe(preset);
    expect(parsePersistedDesign({ ...DEFAULT_THEME, preset })).toEqual(migrated);
  });

  it('never infers a version for the public validator', () => {
    expect(() => validateBlogDesignSpec(DEFAULT_THEME)).toThrow('version');
  });
});

describe('content profile', () => {
  const post = (content: string, tags: string[] = []): Post => ({ id: crypto.randomUUID(), title: 'Post', slug: crypto.randomUUID(), date: '2026-01-01T00:00:00Z', content, tags });

  it('uses deterministic length and feature thresholds without an LLM', () => {
    const profile = createContentProfile([
      post(`${'a'.repeat(1_500)}\n\n\`\`\`ts\nconst value = 1;\n\`\`\`\n\n![image](https://example.com/a.png)\n\n$$x^2$$`, ['AI', 'Code']),
      post(`${'b'.repeat(1_500)}\n\n\`inline\`\n\n![image](https://example.com/b.png)`, ['ai']),
      post('plain', ['Writing']),
    ]);
    expect(profile).toEqual({ postCount: 3, tagCount: 3, averageLength: 'medium', codeUsage: 'frequent', imageUsage: 'frequent', mathUsage: 'some' });
  });
});
