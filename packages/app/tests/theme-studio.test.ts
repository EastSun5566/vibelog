import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, contrastRatio } from '@vibelog/core';
import { describeTheme, paletteForTheme, THEME_PALETTES, themeFromControls, themesEqual } from '../src/theme-studio.js';

const controls = {
  preset: 'editorial', palette: 'newsprint', bodyFont: 'system-serif', headingFont: 'system-sans',
  scale: 'large', contentWidth: 'wide', density: 'compact', radius: 'none',
  headerStyle: 'centered', footerStyle: 'minimal', postListStyle: 'numbered', indexLayout: 'list',
  indexColumns: '1', indexShowDescription: 'true', indexShowTags: 'true',
  articleLayout: 'reading', articleToc: 'auto-inline', articleHeader: 'simple', articleMetadata: 'compact', articleNavigation: 'links', codeBlockStyle: 'panel',
};

describe('Theme Studio controls', () => {
  it('maps curated controls to one deterministic safe theme', () => {
    const theme = themeFromControls(DEFAULT_DESIGN, controls);
    expect(theme).toMatchObject({
      version: 1,
      theme: {
        motif: 'editorial', appearance: 'light', colors: THEME_PALETTES.newsprint.colors,
        typography: { bodyFont: 'system-serif', headingFont: 'system-sans', scale: 'large' },
        layout: { contentWidth: 'wide', density: 'compact', radius: 'none' },
      },
      chrome: { header: { variant: 'centered' }, footer: { variant: 'minimal' } },
      pages: { index: { layout: 'list', itemVariant: 'numbered' }, article: { layout: 'reading', codeBlock: 'panel' } },
      description: 'Editorial · Newsprint · Serif / Sans · Large · Centered header · Numbered list · Code panel',
    });
    expect(paletteForTheme(theme)).toBe('newsprint');
    expect(describeTheme(theme)).toBe(theme.description);
  });

  it('keeps an AI palette unless the user selects a curated replacement', () => {
    const aiTheme = { ...DEFAULT_DESIGN, theme: { ...DEFAULT_DESIGN.theme, colors: { ...DEFAULT_DESIGN.theme.colors, accent: '#075985' } }, description: 'AI design' };
    const theme = themeFromControls(aiTheme, { ...controls, palette: undefined });
    expect(theme.theme.colors).toEqual(aiTheme.theme.colors);
    expect(paletteForTheme(theme)).toBeNull();
  });

  it('supports a monospaced body through Fine-tune controls', () => {
    const theme = themeFromControls(DEFAULT_DESIGN, { ...controls, bodyFont: 'system-mono' });
    expect(theme.theme.typography.bodyFont).toBe('system-mono');
    expect(theme.description).toContain('Mono / Sans');
  });

  it('edits and reorders typed homepage sections without accepting invalid combinations', () => {
    const base = structuredClone(DEFAULT_DESIGN);
    base.pages.home.sections = [
      { type: 'intro', variant: 'minimal', showAuthor: true },
      { type: 'recent-posts', variant: 'list', limit: 5, columns: 1 },
    ];
    const updated = themeFromControls(base, {
      ...controls,
      'homeSection:0:variant': 'centered',
      'homeSection:0:showAuthor': 'false',
      'homeSection:1:variant': 'grid',
      'homeSection:1:limit': '6',
      'homeSection:1:columns': '2',
      homeSections: JSON.stringify(base.pages.home.sections),
      compositionAction: 'up:1',
    });
    expect(updated.pages.home.sections).toEqual([
      { type: 'recent-posts', variant: 'grid', limit: 6, columns: 2 },
      { type: 'intro', variant: 'centered', showAuthor: false },
    ]);
    expect(() => themeFromControls(base, { ...controls, articleToc: 'auto-aside', articleLayout: 'reading' })).toThrow('Aside TOC');
  });

  it('edits index metadata and constrained semantic styles through the same validator', () => {
    const design = themeFromControls(DEFAULT_DESIGN, {
      ...controls,
      indexLayout: 'grid',
      indexColumns: '3',
      indexShowDescription: 'false',
      indexShowTags: 'true',
      'style:home.intro:textAlign': 'center',
      'style:home.intro:paddingBlock': 'xl',
      'style:home.intro:gap': '',
      'style:home.intro:surface': 'surface',
      'style:home.intro:border': 'hairline',
      'style:home.intro:width': 'reading',
    });
    expect(design.pages.index).toMatchObject({ layout: 'grid', columns: 3, showDescription: false, showTags: true });
    expect(design.styles.rules).toEqual([{
      target: 'home.intro',
      declarations: { textAlign: 'center', paddingBlock: 'xl', surface: 'surface', border: 'hairline', width: 'reading' },
    }]);
    expect(() => themeFromControls(DEFAULT_DESIGN, { ...controls, indexColumns: '2' })).toThrow('List columns');
  });

  it('ships six palettes with readable text and links', () => {
    expect(Object.keys(THEME_PALETTES)).toEqual(['paper', 'newsprint', 'mist', 'pine', 'midnight', 'charcoal']);
    for (const palette of Object.values(THEME_PALETTES)) {
      expect(contrastRatio(palette.colors.text, palette.colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.colors.accent, palette.colors.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rejects unknown controls and compares complete themes', () => {
    expect(() => themeFromControls(DEFAULT_DESIGN, { ...controls, palette: 'custom' })).toThrow('palette');
    expect(() => themeFromControls(DEFAULT_DESIGN, { ...controls, preset: 'magazine' })).toThrow('preset');
    expect(themesEqual(DEFAULT_DESIGN, structuredClone(DEFAULT_DESIGN))).toBe(true);
    expect(themesEqual(DEFAULT_DESIGN, { ...DEFAULT_DESIGN, theme: { ...DEFAULT_DESIGN.theme, layout: { ...DEFAULT_DESIGN.theme.layout, radius: 'round' } } })).toBe(false);
  });
});
