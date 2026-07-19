import { validateThemeConfig } from '@vibelog/core';
import type { ThemeColors, ThemeConfig } from '@vibelog/core';

type ThemePreset = ThemeConfig['preset'];
type ThemeBodyFont = ThemeConfig['bodyFont'];
type ThemeHeadingFont = ThemeConfig['headingFont'];
type ThemeScale = ThemeConfig['scale'];
type ThemeContentWidth = ThemeConfig['contentWidth'];
type ThemeDensity = ThemeConfig['density'];
type ThemeRadius = ThemeConfig['radius'];

export const THEME_PALETTES = {
  paper: {
    label: 'Paper', appearance: 'light',
    colors: { background: '#fcfbf7', surface: '#f3f0e7', text: '#24211c', muted: '#665f55', accent: '#1f5d8f', border: '#d8d1c4' },
  },
  newsprint: {
    label: 'Newsprint', appearance: 'light',
    colors: { background: '#f5f0e6', surface: '#ebe2d2', text: '#1f1b16', muted: '#665b4e', accent: '#8b2f2f', border: '#d8cbb8' },
  },
  mist: {
    label: 'Mist', appearance: 'light',
    colors: { background: '#f4f7f8', surface: '#e8eef0', text: '#17252d', muted: '#52656f', accent: '#075985', border: '#c5d0d5' },
  },
  pine: {
    label: 'Pine', appearance: 'light',
    colors: { background: '#f4f7f2', surface: '#e6eee2', text: '#1d291c', muted: '#596858', accent: '#2f6b3c', border: '#c7d3c3' },
  },
  midnight: {
    label: 'Midnight', appearance: 'dark',
    colors: { background: '#111827', surface: '#1f2937', text: '#f3f4f6', muted: '#b8c0cc', accent: '#7dd3fc', border: '#374151' },
  },
  charcoal: {
    label: 'Charcoal', appearance: 'dark',
    colors: { background: '#181817', surface: '#262624', text: '#f5f5f0', muted: '#bebdb4', accent: '#f0b35b', border: '#44443f' },
  },
} as const satisfies Record<string, { label: string; appearance: ThemeConfig['appearance']; colors: ThemeColors }>;

export type ThemePaletteName = keyof typeof THEME_PALETTES;
export interface ThemeControlValues {
  preset: ThemePreset;
  palette: ThemePaletteName | null;
  bodyFont: ThemeBodyFont;
  headingFont: ThemeHeadingFont;
  scale: ThemeScale;
  contentWidth: ThemeContentWidth;
  density: ThemeDensity;
  radius: ThemeRadius;
}

const OPTIONS = {
  preset: ['minimal', 'editorial', 'notebook'],
  bodyFont: ['system-sans', 'system-serif'],
  headingFont: ['system-sans', 'system-serif', 'system-mono'],
  scale: ['compact', 'comfortable', 'large'],
  contentWidth: ['narrow', 'medium', 'wide'],
  density: ['compact', 'comfortable'],
  radius: ['none', 'soft', 'round'],
} as const;

function exactColors(first: ThemeColors, second: ThemeColors): boolean {
  return (Object.keys(first) as (keyof ThemeColors)[]).every((key) => first[key].toLowerCase() === second[key].toLowerCase());
}

export function paletteForTheme(theme: ThemeConfig): ThemePaletteName | null {
  for (const [name, palette] of Object.entries(THEME_PALETTES) as [ThemePaletteName, (typeof THEME_PALETTES)[ThemePaletteName]][]) {
    if (theme.appearance === palette.appearance && exactColors(theme.colors, palette.colors)) return name;
  }
  return null;
}

export function themeControlValues(theme: ThemeConfig): ThemeControlValues {
  return {
    preset: theme.preset,
    palette: paletteForTheme(theme),
    bodyFont: theme.bodyFont,
    headingFont: theme.headingFont,
    scale: theme.scale,
    contentWidth: theme.contentWidth,
    density: theme.density,
    radius: theme.radius,
  };
}

function stringValue(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === 'string' ? input[key] : undefined;
}

function enumValue<const T extends readonly string[]>(input: Record<string, unknown>, key: string, allowed: T): T[number] {
  const value = stringValue(input, key);
  if (!value || !allowed.includes(value)) throw new Error(`Invalid theme control: ${key}`);
  return value as T[number];
}

const LABELS = {
  preset: { minimal: 'Minimal', editorial: 'Editorial', notebook: 'Notebook' },
  bodyFont: { 'system-sans': 'Sans', 'system-serif': 'Serif' },
  headingFont: { 'system-sans': 'Sans', 'system-serif': 'Serif', 'system-mono': 'Mono' },
  scale: { compact: 'Compact', comfortable: 'Medium', large: 'Large' },
} as const;

export function describeTheme(theme: ThemeConfig): string {
  const palette = paletteForTheme(theme);
  return `${LABELS.preset[theme.preset]} · ${palette ? THEME_PALETTES[palette].label : 'AI palette'} · ${LABELS.bodyFont[theme.bodyFont]} / ${LABELS.headingFont[theme.headingFont]} · ${LABELS.scale[theme.scale]}`;
}

export function themeFromControls(baseTheme: ThemeConfig, input: Record<string, unknown>): ThemeConfig {
  const paletteName = stringValue(input, 'palette');
  const palette = paletteName ? THEME_PALETTES[paletteName as ThemePaletteName] : undefined;
  if (paletteName && !palette) throw new Error('Invalid theme control: palette');
  const next: ThemeConfig = {
    ...baseTheme,
    preset: enumValue(input, 'preset', OPTIONS.preset),
    appearance: palette?.appearance ?? baseTheme.appearance,
    colors: palette ? { ...palette.colors } : { ...baseTheme.colors },
    bodyFont: enumValue(input, 'bodyFont', OPTIONS.bodyFont),
    headingFont: enumValue(input, 'headingFont', OPTIONS.headingFont),
    scale: enumValue(input, 'scale', OPTIONS.scale),
    contentWidth: enumValue(input, 'contentWidth', OPTIONS.contentWidth),
    density: enumValue(input, 'density', OPTIONS.density),
    radius: enumValue(input, 'radius', OPTIONS.radius),
    description: '',
  };
  next.description = describeTheme(next);
  return validateThemeConfig(next);
}

export function themesEqual(first: ThemeConfig, second: ThemeConfig): boolean {
  return JSON.stringify(validateThemeConfig(first)) === JSON.stringify(validateThemeConfig(second));
}
