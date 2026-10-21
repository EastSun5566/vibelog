import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN_V2,
  contrastRatio,
  validateBlogDesignSpecV2,
  type BlogDesignSpecV2,
} from '@vibelog/core';
import { applyDesignPreset, DESIGN_PRESET_IDS, DESIGN_PRESETS } from '../src/design-presets.js';
import { paletteForTheme, THEME_PALETTES, themeFromControls } from '../src/theme-studio.js';

function withPalette(name: keyof typeof THEME_PALETTES): BlogDesignSpecV2 {
  const design = structuredClone(DEFAULT_DESIGN_V2);
  design.theme.appearance = THEME_PALETTES[name].appearance;
  design.theme.colors = { ...THEME_PALETTES[name].colors };
  return validateBlogDesignSpecV2(design);
}

const asideDesign = themeFromControls(DEFAULT_DESIGN_V2, {
  preset: 'minimal',
  palette: 'midnight',
  bodyFont: 'system-sans',
  headingFont: 'system-sans',
  scale: 'compact',
  contentWidth: 'wide',
  density: 'compact',
  radius: 'soft',
  headerStyle: 'compact',
  footerStyle: 'minimal',
  homeLayout: 'sidebar',
  postListStyle: 'cards',
  indexLayout: 'grid',
  indexColumns: '3',
  indexShowDescription: 'true',
  indexShowTags: 'false',
  articleLayout: 'with-aside',
  articleToc: 'auto-aside',
  articleHeader: 'simple',
  articleMetadata: 'detailed',
  articleNavigation: 'cards',
  codeBlockStyle: 'plain',
});

const bases: [string, BlogDesignSpecV2][] = [
  ['default', DEFAULT_DESIGN_V2],
  ...Object.keys(THEME_PALETTES).map(
    (name) =>
      [`${name} palette`, withPalette(name as keyof typeof THEME_PALETTES)] as [
        string,
        BlogDesignSpecV2,
      ],
  ),
  ['sidebar home with an aside article', asideDesign],
];

describe('design presets', () => {
  it.each(
    DESIGN_PRESET_IDS.flatMap((id) => bases.map(([name, base]) => [id, name, base] as const)),
  )('%s applies cleanly to the %s design', (id, _name, base) => {
    const original = structuredClone(base);
    const design = applyDesignPreset(base, id);
    expect(base).toEqual(original);
    expect(validateBlogDesignSpecV2(design)).toEqual(design);
    expect(
      contrastRatio(design.theme.colors.text, design.theme.colors.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(design.theme.colors.accent, design.theme.colors.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(design.theme.colors.muted, design.theme.colors.background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(design).not.toEqual(base);
    expect(design.pages.home.sections).toEqual(base.pages.home.sections);
    expect(design.pages.article.modules).toEqual(base.pages.article.modules);
  });

  it('matches each chip to its wording', () => {
    const magazine = applyDesignPreset(DEFAULT_DESIGN_V2, 'magazine');
    expect(magazine.theme.motif).toBe('editorial');
    expect(paletteForTheme(magazine)).toBe('newsprint');
    expect(magazine.theme.typography.headingFont).toBe('system-serif');
    expect(magazine.chrome.header.variant).toBe('masthead');

    const readable = applyDesignPreset(withPalette('pine'), 'readable');
    expect(paletteForTheme(readable)).toBe('pine');
    expect(readable.theme.typography).toMatchObject({ bodyFont: 'system-serif', scale: 'large' });
    expect(readable.theme.layout.contentWidth).toBe('narrow');
    expect(applyDesignPreset(asideDesign, 'readable').pages.article.layout).toBe('with-aside');

    const personality = applyDesignPreset(withPalette('midnight'), 'personality');
    expect(personality.theme.appearance).toBe('dark');
    expect(personality.theme.colors.accent).toBe('#f9a8d4');
    expect(personality.theme.typography.headingFont).toBe('system-mono');

    const night = applyDesignPreset(withPalette('paper'), 'night');
    expect(night.theme.appearance).toBe('dark');
    expect(paletteForTheme(night)).toBe('charcoal');
    expect(night.theme.typography).toEqual(withPalette('paper').theme.typography);
  });

  it('keeps a low-contrast accent change out of custom palettes', () => {
    const custom = structuredClone(DEFAULT_DESIGN_V2);
    custom.theme.colors = {
      ...custom.theme.colors,
      background: '#5b0f2e',
      text: '#ffffff',
      accent: '#ffe08a',
    };
    const design = applyDesignPreset(validateBlogDesignSpecV2(custom), 'personality');
    expect(design.theme.colors.accent).toBe('#ffe08a');
  });

  it('labels every preset with its chip text', () => {
    expect(Object.values(DESIGN_PRESETS).map((preset) => preset.label)).toEqual([
      'A restrained independent magazine',
      'Make long articles easier to read',
      'Keep it minimal but add personality',
      'A dark design for night reading',
    ]);
  });
});
