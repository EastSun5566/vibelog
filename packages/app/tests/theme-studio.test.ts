import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, contrastRatio } from '@vibelog/core';
import { describeTheme, paletteForTheme, THEME_PALETTES, themeFromControls, themesEqual } from '../src/theme-studio.js';

const controls = {
  preset: 'editorial', palette: 'newsprint', bodyFont: 'system-serif', headingFont: 'system-sans',
  scale: 'large', contentWidth: 'wide', density: 'compact', radius: 'none',
};

describe('Theme Studio controls', () => {
  it('maps curated controls to one deterministic safe theme', () => {
    const theme = themeFromControls(DEFAULT_THEME, controls);
    expect(theme).toMatchObject({
      preset: 'editorial', appearance: 'light', colors: THEME_PALETTES.newsprint.colors,
      bodyFont: 'system-serif', headingFont: 'system-sans', scale: 'large', contentWidth: 'wide', density: 'compact', radius: 'none',
      description: 'Editorial · Newsprint · Serif / Sans · Large',
    });
    expect(paletteForTheme(theme)).toBe('newsprint');
    expect(describeTheme(theme)).toBe(theme.description);
  });

  it('keeps an AI palette unless the user selects a curated replacement', () => {
    const aiTheme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, accent: '#075985' }, description: 'AI theme' };
    const theme = themeFromControls(aiTheme, { ...controls, palette: undefined });
    expect(theme.colors).toEqual(aiTheme.colors);
    expect(paletteForTheme(theme)).toBeNull();
  });

  it('ships six palettes with readable text and links', () => {
    expect(Object.keys(THEME_PALETTES)).toEqual(['paper', 'newsprint', 'mist', 'pine', 'midnight', 'charcoal']);
    for (const palette of Object.values(THEME_PALETTES)) {
      expect(contrastRatio(palette.colors.text, palette.colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.colors.accent, palette.colors.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rejects unknown controls and compares complete themes', () => {
    expect(() => themeFromControls(DEFAULT_THEME, { ...controls, palette: 'custom' })).toThrow('palette');
    expect(() => themeFromControls(DEFAULT_THEME, { ...controls, preset: 'magazine' })).toThrow('preset');
    expect(themesEqual(DEFAULT_THEME, structuredClone(DEFAULT_THEME))).toBe(true);
    expect(themesEqual(DEFAULT_THEME, { ...DEFAULT_THEME, radius: 'round' })).toBe(false);
  });
});
