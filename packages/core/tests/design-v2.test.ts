import { describe, expect, it } from 'vitest';

import { DEFAULT_DESIGN } from '../src/design/defaults.js';
import { DEFAULT_THEME } from '../src/theme.js';
import { DEFAULT_DESIGN_V2 } from '../src/design/defaults-v2.js';
import { compileDesignCss } from '../src/design/compile-css-v2.js';
import { analyzeDesignImpact } from '../src/design/impact-v2.js';
import { migrateDesignV1ToV2, migratePersistedDesignToV2 } from '../src/design/migrate-v2.js';
import { normalizeDesignV2 } from '../src/design/normalize-v2.js';
import { resolveHomeComposition } from '../src/design/resolve-v2.js';
import { validateBlogDesignSpecV2, type BlogDesignSpecV2 } from '../src/design/schema-v2.js';
import { searchIndexIdentity, structuralBuildIdentity } from '../src/core/builder.js';

function design(update?: (value: BlogDesignSpecV2) => void): BlogDesignSpecV2 {
  const value = migrateDesignV1ToV2(DEFAULT_DESIGN);
  update?.(value);
  return value;
}

describe('Presentation IR v2', () => {
  it('migrates v1 into stable nodes and keeps the original section order', () => {
    const old = structuredClone(DEFAULT_DESIGN);
    old.pages.home.sections.splice(1, 0, { type: 'featured-posts', variant: 'hero', count: 2 });
    old.styles.rules.push({ target: 'home.intro', declarations: { textAlign: 'center', width: 'reading' } });
    const original = structuredClone(old);
    const converted = migrateDesignV1ToV2(old);
    expect(converted.version).toBe(2);
    expect(converted.pages.home.regions.main).toEqual(['intro', 'featured', 'recent']);
    expect(converted.pages.home.sections.recent).toMatchObject({ type: 'posts', exclude: { sections: ['featured'] } });
    expect(converted.pages.home.sections.intro.presentation).toEqual({ align: 'center', width: 'reading' });
    expect(converted.pages.article.modules.navigation).toMatchObject({ type: 'navigation', variant: 'links' });
    expect(old).toEqual(original);
    expect(validateBlogDesignSpecV2(converted)).toEqual(converted);
  });

  it('keeps the new default equivalent to the converted old default', () => {
    expect(analyzeDesignImpact(DEFAULT_DESIGN_V2, migrateDesignV1ToV2(DEFAULT_DESIGN))).toBe('none');
    expect(migratePersistedDesignToV2(DEFAULT_THEME).version).toBe(2);
    expect(migratePersistedDesignToV2(DEFAULT_DESIGN_V2)).toEqual(DEFAULT_DESIGN_V2);
    expect(() => migratePersistedDesignToV2({ version: 3 })).toThrow();
  });

  it('validates stack, sidebar and magazine regions without depending on record order', () => {
    const stack = design();
    expect(validateBlogDesignSpecV2(stack)).toEqual(stack);
    const sidebar = design((value) => {
      value.pages.home = { ...value.pages.home, layout: 'sidebar', regions: { main: ['recent'], aside: ['intro'] } };
    });
    expect(validateBlogDesignSpecV2(sidebar)).toEqual(sidebar);
    const magazine = design((value) => {
      value.pages.home = { ...value.pages.home, layout: 'magazine', regions: { lead: ['intro'], main: ['recent'], rail: [] } };
    });
    expect(validateBlogDesignSpecV2(magazine)).toEqual(magazine);
  });

  it.each([
    ['duplicate placement', (value: BlogDesignSpecV2) => { value.pages.home.regions.main.push('intro'); }],
    ['orphan section', (value: BlogDesignSpecV2) => { value.pages.home.regions.main.pop(); }],
    ['unknown region', (value: BlogDesignSpecV2) => { (value.pages.home.regions as Record<string, unknown>).aside = ['intro']; }],
    ['unknown exclusion', (value: BlogDesignSpecV2) => { (value.pages.home.sections.recent as { exclude?: unknown }).exclude = { sections: ['missing'] }; }],
    ['exclusion cycle', (value: BlogDesignSpecV2) => { (value.pages.home.sections.recent as { exclude?: unknown }).exclude = { sections: ['recent'] }; }],
    ['unsafe node key', (value: BlogDesignSpecV2) => {
      value.pages.home.sections = JSON.parse('{"constructor":{"type":"intro","variant":"minimal","showAuthor":true},"recent":{"type":"posts","source":{"strategy":"latest"},"variant":"list","limit":5}}') as BlogDesignSpecV2['pages']['home']['sections'];
      value.pages.home.regions.main = ['constructor', 'recent'];
    }],
    ['arbitrary CSS', (value: BlogDesignSpecV2) => { (value.pages.home.sections.intro.presentation as Record<string, unknown>) = { css: 'body{display:none}' }; }],
    ['invalid article aside', (value: BlogDesignSpecV2) => { value.pages.article.regions.aside.push('navigation'); value.pages.article.regions.afterBody = []; }],
    ['navigation before body', (value: BlogDesignSpecV2) => { value.pages.article.regions.beforeBody.push('navigation'); value.pages.article.regions.afterBody = []; }],
    ['bad contrast', (value: BlogDesignSpecV2) => { value.theme.colors.text = value.theme.colors.background; }],
  ])('rejects %s', (_name, update) => {
    expect(() => validateBlogDesignSpecV2(design(update))).toThrow();
  });

  it('classifies no-op, presentation and structural changes without mutating either design', () => {
    const initial = design();
    const reordered = structuredClone(initial);
    reordered.pages.home.sections = Object.fromEntries(Object.entries(reordered.pages.home.sections).reverse());
    expect(analyzeDesignImpact(initial, reordered)).toBe('none');
    const color = structuredClone(initial);
    color.theme.colors.surface = '#eeeeee';
    expect(analyzeDesignImpact(initial, color)).toBe('presentation');
    const node = structuredClone(initial);
    node.pages.home.sections.intro.presentation = { spacing: 'spacious' };
    expect(analyzeDesignImpact(initial, node)).toBe('presentation');
    const variant = structuredClone(initial);
    (variant.pages.home.sections.recent as { variant: 'list' | 'cards' }).variant = 'cards';
    expect(analyzeDesignImpact(initial, variant)).toBe('structure');
    const order = structuredClone(initial);
    order.pages.home.regions.main.reverse();
    expect(analyzeDesignImpact(initial, order)).toBe('structure');
    expect(initial).toEqual(design());
  });

  it('keys exact builds by source, canonical design, template and search identity', () => {
    const first = structuredClone(DEFAULT_DESIGN_V2);
    const reordered = structuredClone(first);
    reordered.pages.home.sections = Object.fromEntries(Object.entries(reordered.pages.home.sections).reverse());
    const key = structuralBuildIdentity('source-1', first, 'https://writer.example.com');
    expect(structuralBuildIdentity('source-1', reordered, 'https://writer.example.com')).toBe(key);
    expect(structuralBuildIdentity('source-2', first, 'https://writer.example.com')).not.toBe(key);
    expect(structuralBuildIdentity('source-1', first, 'https://another.example.com')).not.toBe(key);
    const modified = structuredClone(first); modified.pages.index.layout = 'grid'; modified.pages.index.columns = 2;
    expect(structuralBuildIdentity('source-1', modified, 'https://writer.example.com')).not.toBe(key);
    expect(searchIndexIdentity('source-1', 'https://writer.example.com')).toBe(searchIndexIdentity('source-1', 'https://writer.example.com/'));
  });

  it('normalizes casing and empty presentation without modifying stored input', () => {
    const input = design();
    input.theme.colors.surface = '#F7F7F5';
    input.pages.home.sections.intro.presentation = {};
    const original = structuredClone(input);
    const normalized = normalizeDesignV2(input);
    expect(normalized.theme.colors.surface).toBe('#f7f7f5');
    expect(normalized.pages.home.sections.intro.presentation).toBeUndefined();
    expect(normalizeDesignV2(normalized)).toEqual(normalized);
    expect(input).toEqual(original);
    expect(analyzeDesignImpact(DEFAULT_DESIGN_V2, input)).toBe('none');
  });

  it('resolves typed sources and explicit exclusions independently of region order', () => {
    const old = structuredClone(DEFAULT_DESIGN);
    old.pages.home.sections.splice(1, 0, { type: 'featured-posts', variant: 'hero', count: 1 });
    const value = migrateDesignV1ToV2(old);
    const posts = [
      { slug: 'a', publishedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z' },
      { slug: 'b', publishedAt: '2026-03-01T00:00:00Z' },
      { slug: 'c', publishedAt: '2026-02-01T00:00:00Z' },
    ];
    const initial = structuredClone(posts);
    const resolved = resolveHomeComposition(value.pages.home, posts);
    expect(resolved.regions.main?.find((section) => section.id === 'featured')?.posts?.map((post) => post.slug)).toEqual(['b']);
    expect(resolved.regions.main?.find((section) => section.id === 'recent')?.posts?.map((post) => post.slug)).toEqual(['c', 'a']);
    value.pages.home.sections.recent = { ...value.pages.home.sections.recent, type: 'posts', source: { strategy: 'recently-updated' }, variant: 'list', limit: 3, exclude: { sections: ['featured'] } };
    expect(resolveHomeComposition(value.pages.home, posts).regions.main?.find((section) => section.id === 'recent')?.posts?.map((post) => post.slug)).toEqual(['a', 'c']);
    expect(posts).toEqual(initial);
  });

  it('orders equivalent date offsets by actual time and breaks ties by slug', () => {
    const value = design();
    const posts = [
      { slug: 'z', publishedAt: '2026-01-01T08:00:00+08:00' },
      { slug: 'a', publishedAt: '2026-01-01T00:00:00Z' },
      { slug: 'later', publishedAt: '2026-01-01T01:00:00Z' },
    ];
    expect(resolveHomeComposition(value.pages.home, posts).regions.main?.find((section) => section.id === 'recent')?.posts?.map((post) => post.slug)).toEqual(['later', 'a', 'z']);
  });

  it('compiles only validated theme values and stable per-node presentation selectors', () => {
    const value = design((candidate) => {
      candidate.theme.motif = 'notebook';
      candidate.theme.typography.bodyFont = 'system-mono';
      candidate.pages.home.sections.intro.presentation = { width: 'reading', spacing: 'spacious', frame: 'subtle' };
      candidate.pages.article.modules.navigation.presentation = { align: 'center' };
    });
    const css = compileDesignCss(value);
    expect(css).toContain('--theme-body-font:ui-monospace');
    expect(css).toContain('body.page-home [data-design-node="intro"]{max-width:42rem;margin-block:2.5rem;border:1px solid var(--theme-border)}');
    expect(css).toContain('.blog-post [data-design-node="navigation"]{text-align:center}');
    expect(css).not.toContain('variant-');
    expect(css).not.toContain('javascript:');
    const reordered = structuredClone(value);
    reordered.pages.home.sections = Object.fromEntries(Object.entries(reordered.pages.home.sections).reverse());
    expect(compileDesignCss(reordered)).toBe(css);
  });
});
