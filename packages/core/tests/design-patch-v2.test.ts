import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_V2 } from '../src/design/defaults-v2.js';
import { analyzeDesignImpact } from '../src/design/impact-v2.js';
import { applyDesignPatchV2 } from '../src/design/patch-v2.js';
import { validateBlogDesignSpecV2 } from '../src/design/schema-v2.js';

describe('bounded design refinement', () => {
  it('changes one field without mutating unrelated saved design', () => {
    const original = structuredClone(DEFAULT_DESIGN_V2);
    const result = applyDesignPatchV2(original, [{ op: 'replace', path: '/theme/colors/surface', value: '#f3eee5' }]);
    expect(result.theme.colors.surface).toBe('#f3eee5');
    expect(result.pages).toEqual(original.pages);
    expect(original).toEqual(DEFAULT_DESIGN_V2);
    expect(analyzeDesignImpact(original, result)).toBe('presentation');
  });

  it('reorders homepage sections within and across existing regions', () => {
    const within = applyDesignPatchV2(DEFAULT_DESIGN_V2, [{ op: 'move', from: '/pages/home/regions/main/1', path: '/pages/home/regions/main/0' }]);
    expect(within.pages.home.regions.main).toEqual(['recent', 'intro']);
    const sidebar = validateBlogDesignSpecV2({ ...DEFAULT_DESIGN_V2, pages: { ...DEFAULT_DESIGN_V2.pages, home: { ...DEFAULT_DESIGN_V2.pages.home, layout: 'sidebar', regions: { main: ['intro', 'recent'], aside: [] } } } });
    const across = applyDesignPatchV2(sidebar, [{ op: 'move', from: '/pages/home/regions/main/1', path: '/pages/home/regions/aside/0' }]);
    expect(across.pages.home.regions).toEqual({ main: ['intro'], aside: ['recent'] });
    const appended = applyDesignPatchV2(sidebar, [{ op: 'move', from: '/pages/home/regions/main/0', path: '/pages/home/regions/main/-' }]);
    expect(appended.pages.home.regions.main).toEqual(['recent', 'intro']);
    const added = applyDesignPatchV2(sidebar, [
      { op: 'remove', path: '/pages/home/regions/main/0' },
      { op: 'add', path: '/pages/home/regions/main/-', value: 'intro' },
    ]);
    expect(added.pages.home.regions.main).toEqual(['recent', 'intro']);
    expect(sidebar.pages.home.regions).toEqual({ main: ['intro', 'recent'], aside: [] });
  });

  it('supports an optional presentation field and recognizes no-op edits', () => {
    const next = applyDesignPatchV2(DEFAULT_DESIGN_V2, [{ op: 'add', path: '/pages/home/sections/intro/presentation', value: { spacing: 'relaxed' } }]);
    expect(next.pages.home.sections.intro?.presentation?.spacing).toBe('relaxed');
    const removed = applyDesignPatchV2(next, [{ op: 'remove', path: '/pages/home/sections/intro/presentation' }]);
    expect(analyzeDesignImpact(DEFAULT_DESIGN_V2, removed)).toBe('none');
    expect(analyzeDesignImpact(DEFAULT_DESIGN_V2, applyDesignPatchV2(DEFAULT_DESIGN_V2, [{ op: 'replace', path: '/theme/layout/radius', value: 'soft' }]))).toBe('none');
  });

  it.each([
    [{ op: 'replace', path: '/version', value: 3 }],
    [{ op: 'replace', path: '/theme', value: {} }],
    [{ op: 'replace', path: '/theme/__proto__/polluted', value: true }],
    [{ op: 'replace', path: '/theme/colors/~2text', value: '#123456' }],
    [{ op: 'replace', path: '/pages/home/regions/main/9', value: 'intro' }],
    [{ op: 'replace', path: '/pages/home/regions/main/-', value: 'intro' }],
    [{ op: 'remove', path: '/pages/home/regions/main/-' }],
    [{ op: 'move', from: '/pages/home/regions/main/-', path: '/pages/home/regions/aside/0' }],
    [{ op: 'move', from: '/pages/home/regions/main/0', path: '/pages/article/regions/beforeBody/0' }],
    [{ op: 'remove', path: '/pages/home/sections/recent' }],
    [{ op: 'replace', path: '/theme/colors/text', value: '#ffffff' }],
    [{ op: 'replace', path: '/theme/typography/bodyFont', value: 'comic-sans' }],
  ])('rejects unsafe or invalid refinement %#', (patches) => {
    expect(() => applyDesignPatchV2(DEFAULT_DESIGN_V2, patches)).toThrow();
    expect(DEFAULT_DESIGN_V2.pages.home.regions.main).toEqual(['intro', 'recent']);
  });

  it('rejects over-limit and malformed patch batches', () => {
    expect(() => applyDesignPatchV2(DEFAULT_DESIGN_V2, [])).toThrow();
    expect(() => applyDesignPatchV2(DEFAULT_DESIGN_V2, Array.from({ length: 17 }, () => ({ op: 'replace', path: '/description', value: 'test' })))).toThrow();
    expect(() => applyDesignPatchV2(DEFAULT_DESIGN_V2, [{ op: 'replace', path: '/description', value: 'x'.repeat(33_000) }])).toThrow();
    expect(() => applyDesignPatchV2(DEFAULT_DESIGN_V2, [{ op: 'replace', path: '/description', value: 'test', extra: true }])).toThrow();
    expect(() => applyDesignPatchV2(DEFAULT_DESIGN_V2, [{ op: 'replace', path: '/description', value: { constructor: 'unsafe' } }])).toThrow();
  });
});
