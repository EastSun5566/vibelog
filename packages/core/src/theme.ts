import type { ThemeConfig } from './types.js';

const HEX = /^#[0-9a-f]{6}$/i;
const ENUMS = {
  preset: ['minimal', 'editorial', 'notebook'], appearance: ['light', 'dark'],
  bodyFont: ['system-sans', 'system-serif'], headingFont: ['system-sans', 'system-serif', 'system-mono'],
  scale: ['compact', 'comfortable', 'large'], contentWidth: ['narrow', 'medium', 'wide'],
  density: ['compact', 'comfortable'], radius: ['none', 'soft', 'round'],
} as const;
const CONFIG_KEYS = [...Object.keys(ENUMS), 'colors', 'description'].sort();
const COLOR_KEYS = ['accent', 'background', 'border', 'muted', 'surface', 'text'];

export const DEFAULT_THEME: ThemeConfig = {
  preset: 'minimal', appearance: 'light',
  colors: { background: '#ffffff', surface: '#f7f7f5', text: '#1f2328', muted: '#59636e', accent: '#075985', border: '#d0d7de' },
  bodyFont: 'system-sans', headingFont: 'system-sans', scale: 'comfortable', contentWidth: 'medium', density: 'comfortable', radius: 'soft',
  description: 'A clear, quiet theme that keeps the writing first.',
};

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} contains missing or unknown fields`);
}

function channel(value: string): number {
  const normalized = Number.parseInt(value, 16) / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  if (!HEX.test(foreground) || !HEX.test(background)) throw new Error('Contrast colors must be six-digit hex values');
  const luminance = (color: string) => {
    const red = channel(color.slice(1, 3));
    const green = channel(color.slice(3, 5));
    const blue = channel(color.slice(5, 7));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function validateThemeConfig(input: unknown): ThemeConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Theme must be an object');
  const value = input as Record<string, unknown>;
  assertExactKeys(value, CONFIG_KEYS, 'Theme');
  for (const [key, allowed] of Object.entries(ENUMS)) if (!allowed.includes(value[key] as never)) throw new Error(`Invalid theme ${key}`);
  if (!value.colors || typeof value.colors !== 'object' || Array.isArray(value.colors)) throw new Error('Theme colors must be an object');
  const colors = value.colors as Record<string, unknown>;
  assertExactKeys(colors, COLOR_KEYS, 'Theme colors');
  for (const key of COLOR_KEYS) if (typeof colors[key] !== 'string' || !HEX.test(colors[key])) throw new Error(`Invalid theme color: ${key}`);
  if (typeof value.description !== 'string' || value.description.trim().length < 1 || value.description.length > 240) throw new Error('Theme description must be between 1 and 240 characters');
  if (contrastRatio(colors.text as string, colors.background as string) < 4.5) throw new Error('Theme text does not have enough contrast against the background');
  if (contrastRatio(colors.accent as string, colors.background as string) < 4.5) throw new Error('Theme links do not have enough contrast against the background');
  return structuredClone(input) as ThemeConfig;
}

const FONT_STACKS = {
  'system-sans': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'system-serif': 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  'system-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};
const SCALE = { compact: '15px', comfortable: '16px', large: '18px' };
const WIDTH = { narrow: '42rem', medium: '52rem', wide: '66rem' };
const DENSITY = { compact: '1rem', comfortable: '1.5rem' };
const RADIUS = { none: '0', soft: '0.5rem', round: '1rem' };
const PRESETS = {
  minimal: `/* Preset: minimal */
.blog-list-item {
  border-bottom: 1px solid var(--theme-border);
  padding-block: calc(var(--theme-space) * 1.15);
}
.blog-list-item:first-child { border-top: 1px solid var(--theme-border); }
.article-navigation-link { border-top: 1px solid var(--theme-border); }`,
  editorial: `/* Preset: editorial */
h1, h2, h3 { letter-spacing: -0.045em; }
.site-header { border-bottom: 3px double var(--theme-border); }
.blog-list { gap: var(--theme-space); }
.blog-list-item {
  border-top: 1px solid var(--theme-border);
  padding-block: calc(var(--theme-space) * 1.25);
}
.blog-list-item:first-child .blog-item-title { font-size: clamp(1.75rem, 4vw, 2.8rem); }
.article-navigation-link { border-top: 3px double var(--theme-border); }
@media (min-width: 48rem) {
  .blog-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .blog-list-item:first-child { grid-column: 1 / -1; }
  .blog-list-item:first-child .blog-item-link { min-height: 8rem; }
}`,
  notebook: `/* Preset: notebook */
body {
  background-image: linear-gradient(var(--theme-border) 1px, transparent 1px);
  background-size: 100% 1.75rem;
}
.site-header nav, main, .site-footer, footer { background: var(--theme-background); }
.blog-list { gap: var(--theme-space); }
.blog-list-item,
.article-navigation-link {
  background: var(--theme-surface);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius);
  padding: var(--theme-space);
}
.blog-item-link { min-height: 6rem; }`,
};

export function renderThemeCss(input: ThemeConfig): string {
  const theme = validateThemeConfig(input);
  return `/* Generated by VibeLog. Theme revisions are immutable. */
:root {
  color-scheme: ${theme.appearance};
  --theme-background: ${theme.colors.background};
  --theme-surface: ${theme.colors.surface};
  --theme-text: ${theme.colors.text};
  --theme-muted: ${theme.colors.muted};
  --theme-accent: ${theme.colors.accent};
  --theme-border: ${theme.colors.border};
  --theme-body-font: ${FONT_STACKS[theme.bodyFont]};
  --theme-heading-font: ${FONT_STACKS[theme.headingFont]};
  --theme-font-size: ${SCALE[theme.scale]};
  --theme-content-width: ${WIDTH[theme.contentWidth]};
  --theme-space: ${DENSITY[theme.density]};
  --theme-radius: ${RADIUS[theme.radius]};
}
body { background: var(--theme-background); color: var(--theme-text); font-family: var(--theme-body-font); font-size: var(--theme-font-size); }
h1, h2, h3, h4, h5, h6 { color: var(--theme-text); font-family: var(--theme-heading-font); }
a { color: var(--theme-accent); }
.site-header, .site-footer, footer { background: var(--theme-background); border-color: var(--theme-border); }
.site-header nav, main, .site-footer, footer { box-sizing: border-box; margin-inline: auto; max-width: var(--theme-content-width); padding-inline: var(--theme-space); }
.site-title, .site-header h2 a, .site-nav-links a { color: var(--theme-text); }
.site-nav-links a:hover, .site-nav-links a.active, .site-nav-links a[aria-current="page"] { color: var(--theme-accent); }
small, time, .muted, .eyebrow, .blog-item-date, .blog-post-date, .blog-post-update, .article-navigation-link span { color: var(--theme-muted); }
.blog-list-item, .blog-post, .article-navigation-link { border-color: var(--theme-border); }
pre, code, blockquote, .prose th, .prose td { background: var(--theme-surface); border-color: var(--theme-border); border-radius: var(--theme-radius); }
.skip-link { background: var(--theme-text); color: var(--theme-background); border-radius: var(--theme-radius); }
${PRESETS[theme.preset]}
`;
}
