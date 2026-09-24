import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_V2, analyzeDesignImpact, contrastRatio } from '@vibelog/core';
import { describeTheme, paletteForTheme, THEME_PALETTES, themeFromControls, themesEqual, visualThemeFromControls } from '../src/theme-studio.js';

const controls = {
  preset: 'editorial', palette: 'newsprint', bodyFont: 'system-serif', headingFont: 'system-sans',
  scale: 'large', contentWidth: 'wide', density: 'compact', radius: 'none',
  headerStyle: 'centered', footerStyle: 'minimal', homeLayout: 'stack', postListStyle: 'numbered', indexLayout: 'list',
  indexColumns: '1', indexShowDescription: 'true', indexShowTags: 'true',
  articleLayout: 'reading', articleToc: 'auto-inline', articleHeader: 'simple', articleMetadata: 'compact', articleNavigation: 'links', codeBlockStyle: 'panel',
};

describe('V2 design studio', () => {
  it('maps curated controls to validated V2 without mutating the original', () => {
    const original = structuredClone(DEFAULT_DESIGN_V2);
    const design = themeFromControls(original, controls);
    expect(design).toMatchObject({ version: 2, theme: { motif: 'editorial', colors: THEME_PALETTES.newsprint.colors }, pages: { index: { item: { variant: 'numbered' } }, article: { prose: { codeBlock: 'panel' } } } });
    expect(paletteForTheme(design)).toBe('newsprint');
    expect(describeTheme(design)).toBe(design.description);
    expect(original).toEqual(DEFAULT_DESIGN_V2);
  });

  it('keeps an AI palette when no replacement is selected and supports mono text', () => {
    const design = themeFromControls(DEFAULT_DESIGN_V2, { ...controls, palette: undefined, bodyFont: 'system-mono' });
    expect(design.theme.colors).toEqual(DEFAULT_DESIGN_V2.theme.colors);
    expect(design.theme.typography.bodyFont).toBe('system-mono');
  });

  it('edits keyed home nodes and semantic presentation', () => {
    const design = themeFromControls(DEFAULT_DESIGN_V2, {
      ...controls, 'home:intro:variant': 'centered', 'home:intro:showAuthor': 'false',
      'home:recent:variant': 'grid', 'home:recent:limit': '6', 'home:recent:columns': '2',
      'presentation:home.intro:align': 'center', 'presentation:home.intro:spacing': 'relaxed',
    });
    expect(design.pages.home.sections.intro).toMatchObject({ type: 'intro', variant: 'centered', showAuthor: false, presentation: { align: 'center', spacing: 'relaxed' } });
    expect(design.pages.home.sections.recent).toMatchObject({ type: 'posts', variant: 'grid', columns: 2, limit: 6 });
    expect(analyzeDesignImpact(DEFAULT_DESIGN_V2, design)).toBe('structure');
  });

  it('keeps structural edits out of the live CSS preview', () => {
    const preview = visualThemeFromControls(DEFAULT_DESIGN_V2, { ...controls, headerStyle: 'masthead', indexLayout: 'grid', indexColumns: '2', 'presentation:home.intro:align': 'center' });
    expect(preview.theme.motif).toBe('editorial');
    expect(preview.chrome.header.variant).toBe(DEFAULT_DESIGN_V2.chrome.header.variant);
    expect(preview.pages.index.layout).toBe(DEFAULT_DESIGN_V2.pages.index.layout);
    expect(preview.pages.home.sections.intro?.presentation).toEqual({ align: 'center' });
    expect(analyzeDesignImpact(DEFAULT_DESIGN_V2, preview)).toBe('presentation');
  });

  it('validates palette and module placement rather than emitting arbitrary CSS', () => {
    expect(() => themeFromControls(DEFAULT_DESIGN_V2, { ...controls, palette: 'custom' })).toThrow('palette');
    expect(() => themeFromControls(DEFAULT_DESIGN_V2, { ...controls, preset: 'magazine' })).toThrow('preset');
    expect(() => themeFromControls(DEFAULT_DESIGN_V2, { ...controls, 'presentation:home.intro:surface': 'url(javascript:alert(1))' })).toThrow('presentation');
    expect(() => themeFromControls(DEFAULT_DESIGN_V2, { ...controls, articleToc: 'auto-aside', articleLayout: 'reading' })).toThrow();
    expect(themesEqual(DEFAULT_DESIGN_V2, structuredClone(DEFAULT_DESIGN_V2))).toBe(true);
  });

  it('ships six readable palettes', () => {
    expect(Object.keys(THEME_PALETTES)).toEqual(['paper', 'newsprint', 'mist', 'pine', 'midnight', 'charcoal']);
    for (const palette of Object.values(THEME_PALETTES)) {
      expect(contrastRatio(palette.colors.text, palette.colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.colors.accent, palette.colors.background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
