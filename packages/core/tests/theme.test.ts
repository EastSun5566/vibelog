import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, contrastRatio, renderThemeCss, validateThemeConfig } from '../src/theme.js';

describe('theme contract', () => {
  it('renders each repository-owned preset deterministically', () => {
    for (const preset of ['minimal', 'editorial', 'notebook'] as const) {
      const theme = { ...DEFAULT_THEME, preset };
      const css = renderThemeCss(theme);
      expect(css).toBe(renderThemeCss(theme));
      for (const token of ['background', 'surface', 'text', 'muted', 'accent', 'border', 'body-font', 'heading-font', 'font-size', 'content-width', 'space', 'radius']) {
        expect(css).toContain(`--theme-${token}:`);
      }
      expect(css.slice(css.indexOf(`/* Preset: ${preset} */`))).toMatchSnapshot();
    }
  });
  it('keeps selectors required by current and V1 templates', () => {
    const css = renderThemeCss(DEFAULT_THEME);
    const template = [
      '../template/src/components/Header.astro',
      '../template/src/components/Footer.astro',
      '../template/src/components/PostList.astro',
      '../template/src/components/TagList.astro',
      '../template/src/layouts/BlogPost.astro',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
    for (const selector of ['.site-header', '.site-footer', '.blog-list-item', '.blog-post', '.prose', '.tag-link']) {
      expect(css).toContain(selector);
      expect(template).toContain(`class="${selector.slice(1)}`);
    }
    expect(css).toContain('.tag-index-link');
    expect(css).toContain('footer');
  });
  it('rejects unknown fields, unsafe values, and insufficient contrast', () => {
    expect(() => validateThemeConfig({ ...DEFAULT_THEME, css: 'body{}' })).toThrow('unknown');
    expect(() => validateThemeConfig({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, accent: 'url(https://example.com)' } })).toThrow('accent');
    expect(() => validateThemeConfig({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, text: '#eeeeee' } })).toThrow('contrast');
  });
  it('normalizes complete legacy themes and rejects partial V2 themes', () => {
    const { headerStyle: _header, postListStyle: _list, codeBlockStyle: _code, ...legacy } = DEFAULT_THEME;
    expect(validateThemeConfig(legacy)).toMatchObject({ headerStyle: 'compact', postListStyle: 'divided', codeBlockStyle: 'plain' });
    expect(validateThemeConfig({ ...legacy, preset: 'editorial' })).toMatchObject({ headerStyle: 'centered', postListStyle: 'numbered', codeBlockStyle: 'panel' });
    expect(validateThemeConfig({ ...legacy, preset: 'notebook' })).toMatchObject({ headerStyle: 'compact', postListStyle: 'cards', codeBlockStyle: 'panel' });
    expect(() => validateThemeConfig({ ...legacy, headerStyle: 'compact' })).toThrow('incomplete');
  });
  it('renders every V2 presentation variant deterministically', () => {
    const variants = [
      ['headerStyle', [['compact', 'Header: compact'], ['centered', 'Header: centered']]],
      ['postListStyle', [['divided', 'Post list: divided'], ['cards', 'Post list: cards'], ['numbered', 'Post list: numbered']]],
      ['codeBlockStyle', [['plain', 'Code blocks: plain'], ['panel', 'Code blocks: panel']]],
    ] as const;
    for (const [field, values] of variants) {
      for (const [value, marker] of values) {
        const theme = { ...DEFAULT_THEME, [field]: value };
        const css = renderThemeCss(theme);
        expect(css).toBe(renderThemeCss(theme));
        expect(css).toContain(marker);
      }
    }
  });
  it('calculates WCAG contrast ratios', () => { expect(contrastRatio('#000000', '#ffffff')).toBe(21); });
});
