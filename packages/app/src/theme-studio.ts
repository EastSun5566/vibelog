import { DEFAULT_DESIGN, normalizeDesignDecoration, validateBlogDesignSpec } from '@vibelog/core';
import type { BlogDesignSpecV1, HomeSection, StyleRule, StyleTarget, ThemeColors } from '@vibelog/core';

export const THEME_PALETTES = {
  paper: { label: 'Paper', appearance: 'light', colors: { background: '#fcfbf7', surface: '#f3f0e7', text: '#24211c', muted: '#665f55', accent: '#1f5d8f', border: '#d8d1c4' } },
  newsprint: { label: 'Newsprint', appearance: 'light', colors: { background: '#f5f0e6', surface: '#ebe2d2', text: '#1f1b16', muted: '#665b4e', accent: '#8b2f2f', border: '#d8cbb8' } },
  mist: { label: 'Mist', appearance: 'light', colors: { background: '#f4f7f8', surface: '#e8eef0', text: '#17252d', muted: '#52656f', accent: '#075985', border: '#c5d0d5' } },
  pine: { label: 'Pine', appearance: 'light', colors: { background: '#f4f7f2', surface: '#e6eee2', text: '#1d291c', muted: '#596858', accent: '#2f6b3c', border: '#c7d3c3' } },
  midnight: { label: 'Midnight', appearance: 'dark', colors: { background: '#111827', surface: '#1f2937', text: '#f3f4f6', muted: '#b8c0cc', accent: '#7dd3fc', border: '#374151' } },
  charcoal: { label: 'Charcoal', appearance: 'dark', colors: { background: '#181817', surface: '#262624', text: '#f5f5f0', muted: '#bebdb4', accent: '#f0b35b', border: '#44443f' } },
} as const satisfies Record<string, { label: string; appearance: BlogDesignSpecV1['theme']['appearance']; colors: ThemeColors }>;

export type ThemePaletteName = keyof typeof THEME_PALETTES;
export interface ThemeControlValues {
  preset: BlogDesignSpecV1['theme']['motif']; palette: ThemePaletteName | null;
  bodyFont: BlogDesignSpecV1['theme']['typography']['bodyFont']; headingFont: BlogDesignSpecV1['theme']['typography']['headingFont']; scale: BlogDesignSpecV1['theme']['typography']['scale'];
  contentWidth: BlogDesignSpecV1['theme']['layout']['contentWidth']; density: BlogDesignSpecV1['theme']['layout']['density']; radius: BlogDesignSpecV1['theme']['layout']['radius'];
  headerStyle: BlogDesignSpecV1['chrome']['header']['variant']; footerStyle: BlogDesignSpecV1['chrome']['footer']['variant'];
  postListStyle: BlogDesignSpecV1['pages']['index']['itemVariant']; indexLayout: BlogDesignSpecV1['pages']['index']['layout'];
  articleLayout: BlogDesignSpecV1['pages']['article']['layout']; articleToc: BlogDesignSpecV1['pages']['article']['toc']; articleHeader: BlogDesignSpecV1['pages']['article']['header']; articleMetadata: BlogDesignSpecV1['pages']['article']['metadata']; articleNavigation: BlogDesignSpecV1['pages']['article']['navigation']; codeBlockStyle: BlogDesignSpecV1['pages']['article']['codeBlock'];
}

const OPTIONS = {
  preset: ['minimal', 'editorial', 'notebook'], bodyFont: ['system-sans', 'system-serif', 'system-mono'], headingFont: ['system-sans', 'system-serif', 'system-mono'], scale: ['compact', 'comfortable', 'large'], contentWidth: ['narrow', 'medium', 'wide'], density: ['compact', 'comfortable'], radius: ['none', 'soft', 'round'],
  headerStyle: ['compact', 'centered', 'masthead'], footerStyle: ['minimal', 'profile'], postListStyle: ['divided', 'cards', 'numbered'], indexLayout: ['list', 'grid', 'magazine'], articleLayout: ['reading', 'wide', 'with-aside'], articleToc: ['auto-inline', 'auto-aside', 'hidden'], articleHeader: ['simple', 'editorial'], articleMetadata: ['compact', 'detailed'], articleNavigation: ['links', 'cards'], codeBlockStyle: ['plain', 'panel'],
  columns: ['1', '2', '3'], boolean: ['true', 'false'],
  textAlign: ['', 'start', 'center'], paddingBlock: ['', 'none', 'sm', 'md', 'lg', 'xl'], gap: ['', 'sm', 'md', 'lg', 'xl'], surface: ['', 'transparent', 'background', 'surface'], border: ['', 'none', 'hairline', 'strong'], width: ['', 'reading', 'content', 'full'],
} as const;

const STYLE_TARGETS: StyleTarget[] = ['site.header', 'home.intro', 'home.sections', 'posts.items', 'article.header', 'article.prose', 'article.toc', 'site.footer'];
function styleRules(base: StyleRule[], input: Record<string, unknown>): StyleRule[] {
  return STYLE_TARGETS.flatMap((target) => {
    const previous = base.find((rule) => rule.target === target)?.declarations;
    const value = <const T extends readonly string[]>(property: keyof StyleRule['declarations'], allowed: T): T[number] | undefined => {
      const current = stringValue(input, `style:${target}:${property}`);
      if (current === undefined) return previous?.[property] as T[number] | undefined;
      if (!allowed.includes(current)) throw new Error(`Invalid design control: style:${target}:${property}`);
      return current || undefined;
    };
    const textAlign = value('textAlign', OPTIONS.textAlign);
    const paddingBlock = value('paddingBlock', OPTIONS.paddingBlock);
    const gap = value('gap', OPTIONS.gap);
    const surface = value('surface', OPTIONS.surface);
    const border = value('border', OPTIONS.border);
    const width = value('width', OPTIONS.width);
    const declarations: StyleRule['declarations'] = {
      ...(textAlign ? { textAlign } : {}),
      ...(paddingBlock ? { paddingBlock } : {}),
      ...(gap ? { gap } : {}),
      ...(surface ? { surface } : {}),
      ...(border ? { border } : {}),
      ...(width ? { width } : {}),
    };
    return Object.keys(declarations).length > 0 ? [{ target, declarations }] : [];
  });
}

function exactColors(first: ThemeColors, second: ThemeColors): boolean { return (Object.keys(first) as (keyof ThemeColors)[]).every((key) => first[key].toLowerCase() === second[key].toLowerCase()); }
export function paletteForTheme(design: BlogDesignSpecV1): ThemePaletteName | null {
  for (const [name, palette] of Object.entries(THEME_PALETTES) as [ThemePaletteName, (typeof THEME_PALETTES)[ThemePaletteName]][]) if (design.theme.appearance === palette.appearance && exactColors(design.theme.colors, palette.colors)) return name;
  return null;
}
export function themeControlValues(design: BlogDesignSpecV1): ThemeControlValues { return { preset: design.theme.motif, palette: paletteForTheme(design), ...design.theme.typography, ...design.theme.layout, headerStyle: design.chrome.header.variant, footerStyle: design.chrome.footer.variant, postListStyle: design.pages.index.itemVariant, indexLayout: design.pages.index.layout, articleLayout: design.pages.article.layout, articleToc: design.pages.article.toc, articleHeader: design.pages.article.header, articleMetadata: design.pages.article.metadata, articleNavigation: design.pages.article.navigation, codeBlockStyle: design.pages.article.codeBlock }; }
function stringValue(input: Record<string, unknown>, key: string): string | undefined { return typeof input[key] === 'string' ? input[key] : undefined; }
function enumValue<const T extends readonly string[]>(input: Record<string, unknown>, key: string, allowed: T): T[number] { const value = stringValue(input, key); if (!value || !allowed.includes(value)) throw new Error(`Invalid design control: ${key}`); return value as T[number]; }
const LABELS = { preset: { minimal: 'Minimal', editorial: 'Editorial', notebook: 'Notebook' }, bodyFont: { 'system-sans': 'Sans', 'system-serif': 'Serif', 'system-mono': 'Mono' }, headingFont: { 'system-sans': 'Sans', 'system-serif': 'Serif', 'system-mono': 'Mono' }, scale: { compact: 'Compact', comfortable: 'Medium', large: 'Large' }, headerStyle: { compact: 'Compact header', centered: 'Centered header', masthead: 'Masthead' }, postListStyle: { divided: 'Divided list', cards: 'Cards', numbered: 'Numbered list' }, codeBlockStyle: { plain: 'Plain code', panel: 'Code panel' } } as const;
export function describeTheme(design: BlogDesignSpecV1): string { const palette = paletteForTheme(design); return `${LABELS.preset[design.theme.motif]} · ${palette ? THEME_PALETTES[palette].label : 'AI palette'} · ${LABELS.bodyFont[design.theme.typography.bodyFont]} / ${LABELS.headingFont[design.theme.typography.headingFont]} · ${LABELS.scale[design.theme.typography.scale]} · ${LABELS.headerStyle[design.chrome.header.variant]} · ${LABELS.postListStyle[design.pages.index.itemVariant]} · ${LABELS.codeBlockStyle[design.pages.article.codeBlock]}`; }
function homeSections(base: HomeSection[], input: Record<string, unknown>): HomeSection[] {
  const raw = stringValue(input, 'homeSections');
  let sections: HomeSection[];
  try { sections = raw ? JSON.parse(raw) as HomeSection[] : structuredClone(base); }
  catch { throw new Error('Invalid design control: homeSections'); }
  sections = sections.map((section, index) => {
    const prefix = `homeSection:${String(index)}:`;
    const variant = stringValue(input, `${prefix}variant`) ?? section.variant;
    if (section.type === 'intro') return { ...section, variant, showAuthor: (stringValue(input, `${prefix}showAuthor`) ?? String(section.showAuthor)) === 'true' } as HomeSection;
    if (section.type === 'featured-posts') return { ...section, variant, count: Number(stringValue(input, `${prefix}count`) ?? section.count) } as HomeSection;
    if (section.type === 'recent-posts') {
      const columns = stringValue(input, `${prefix}columns`);
      return { ...section, variant, limit: Number(stringValue(input, `${prefix}limit`) ?? section.limit), ...(columns ? { columns: Number(columns) } : {}) } as HomeSection;
    }
    if (section.type === 'topics') return { ...section, variant, limit: Number(stringValue(input, `${prefix}limit`) ?? section.limit) } as HomeSection;
    return { ...section, variant } as HomeSection;
  });
  const action = stringValue(input, 'compositionAction');
  if (action) {
    const [kind, rawIndex] = action.split(':'); const index = Number.parseInt(rawIndex ?? '', 10);
    if (kind === 'up' && index > 0 && index < sections.length) {
      const moved = sections.splice(index, 1)[0];
      if (moved) sections.splice(index - 1, 0, moved);
    }
    if (kind === 'down' && index >= 0 && index < sections.length - 1) {
      const moved = sections.splice(index, 1)[0];
      if (moved) sections.splice(index + 1, 0, moved);
    }
    if (kind === 'remove' && index >= 0 && index < sections.length) sections.splice(index, 1);
    if (kind === 'add') {
      const type = stringValue(input, 'addSectionType');
      const defaults: Record<string, HomeSection> = { intro: { type: 'intro', variant: 'minimal', showAuthor: true }, 'featured-posts': { type: 'featured-posts', variant: 'hero', count: 1 }, 'recent-posts': { type: 'recent-posts', variant: 'list', limit: 5, columns: 1 }, topics: { type: 'topics', variant: 'list', limit: 12 }, author: { type: 'author', variant: 'compact' } };
      const addition = type ? defaults[type] : undefined; if (addition && !sections.some((section) => section.type === addition.type)) sections.push(addition);
    }
  }
  const candidate = { ...DEFAULT_DESIGN, pages: { ...DEFAULT_DESIGN.pages, home: { sections } } };
  return validateBlogDesignSpec(candidate).pages.home.sections;
}
export function themeFromControls(base: BlogDesignSpecV1, input: Record<string, unknown>): BlogDesignSpecV1 {
  const paletteName = stringValue(input, 'palette'); const palette = paletteName ? THEME_PALETTES[paletteName as ThemePaletteName] : undefined; if (paletteName && !palette) throw new Error('Invalid design control: palette');
  const indexLayout = enumValue(input, 'indexLayout', OPTIONS.indexLayout); const articleLayout = enumValue(input, 'articleLayout', OPTIONS.articleLayout); const articleToc = enumValue(input, 'articleToc', OPTIONS.articleToc);
  const indexColumns = Number(enumValue(input, 'indexColumns', OPTIONS.columns));
  const next: BlogDesignSpecV1 = { ...base,
    theme: { motif: enumValue(input, 'preset', OPTIONS.preset), appearance: palette?.appearance ?? base.theme.appearance, colors: palette ? { ...palette.colors } : { ...base.theme.colors }, typography: { bodyFont: enumValue(input, 'bodyFont', OPTIONS.bodyFont), headingFont: enumValue(input, 'headingFont', OPTIONS.headingFont), scale: enumValue(input, 'scale', OPTIONS.scale) }, layout: { contentWidth: enumValue(input, 'contentWidth', OPTIONS.contentWidth), density: enumValue(input, 'density', OPTIONS.density), radius: enumValue(input, 'radius', OPTIONS.radius) } },
    chrome: { header: { variant: enumValue(input, 'headerStyle', OPTIONS.headerStyle) }, footer: { variant: enumValue(input, 'footerStyle', OPTIONS.footerStyle) } },
    pages: { home: { sections: homeSections(base.pages.home.sections, input) }, index: { ...base.pages.index, layout: indexLayout, itemVariant: enumValue(input, 'postListStyle', OPTIONS.postListStyle), columns: indexColumns as 1 | 2 | 3, showDescription: enumValue(input, 'indexShowDescription', OPTIONS.boolean) === 'true', showTags: enumValue(input, 'indexShowTags', OPTIONS.boolean) === 'true' }, article: { ...base.pages.article, layout: articleLayout, toc: articleToc, header: enumValue(input, 'articleHeader', OPTIONS.articleHeader), metadata: enumValue(input, 'articleMetadata', OPTIONS.articleMetadata), navigation: enumValue(input, 'articleNavigation', OPTIONS.articleNavigation), codeBlock: enumValue(input, 'codeBlockStyle', OPTIONS.codeBlockStyle) } },
    styles: { rules: styleRules(base.styles.rules, input) }, description: '',
  };
  next.description = describeTheme(next); return normalizeDesignDecoration(validateBlogDesignSpec(next));
}
export function visualThemeFromControls(base: BlogDesignSpecV1, input: Record<string, unknown>): BlogDesignSpecV1 {
  const candidate = themeFromControls(base, input);
  const visual: BlogDesignSpecV1 = {
    ...candidate,
    chrome: structuredClone(base.chrome),
    pages: structuredClone(base.pages),
  };
  visual.description = describeTheme(visual);
  return normalizeDesignDecoration(validateBlogDesignSpec(visual));
}
export function themesEqual(first: BlogDesignSpecV1, second: BlogDesignSpecV1): boolean { return JSON.stringify(validateBlogDesignSpec(first)) === JSON.stringify(validateBlogDesignSpec(second)); }
