import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, contrastRatio, renderThemeCss, validateThemeConfig } from '../src/theme.js';

describe('theme contract', () => {
  it('renders each repository-owned preset deterministically', () => {
    for (const preset of ['minimal', 'editorial', 'notebook'] as const) {
      const theme = { ...DEFAULT_THEME, preset };
      expect(renderThemeCss(theme)).toBe(renderThemeCss(theme));
      expect(renderThemeCss(theme)).toContain(`--theme-background: ${theme.colors.background}`);
    }
  });
  it('rejects unknown fields, unsafe values, and insufficient contrast', () => {
    expect(() => validateThemeConfig({ ...DEFAULT_THEME, css: 'body{}' })).toThrow('unknown');
    expect(() => validateThemeConfig({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, accent: 'url(https://example.com)' } })).toThrow('accent');
    expect(() => validateThemeConfig({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, text: '#eeeeee' } })).toThrow('contrast');
  });
  it('calculates WCAG contrast ratios', () => { expect(contrastRatio('#000000', '#ffffff')).toBe(21); });
});
