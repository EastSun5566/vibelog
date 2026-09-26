import { normalizeDesignV2, validateBlogDesignSpecV2 } from '@vibelog/core';
import type { BlogDesignSpecV2, PresentationSpec, ThemeColors } from '@vibelog/core';

export const THEME_PALETTES = {
  paper: { label: 'Paper', appearance: 'light', colors: { background: '#fcfbf7', surface: '#f3f0e7', text: '#24211c', muted: '#665f55', accent: '#1f5d8f', border: '#d8d1c4' } },
  newsprint: { label: 'Newsprint', appearance: 'light', colors: { background: '#f5f0e6', surface: '#ebe2d2', text: '#1f1b16', muted: '#665b4e', accent: '#8b2f2f', border: '#d8cbb8' } },
  mist: { label: 'Mist', appearance: 'light', colors: { background: '#f4f7f8', surface: '#e8eef0', text: '#17252d', muted: '#52656f', accent: '#075985', border: '#c5d0d5' } },
  pine: { label: 'Pine', appearance: 'light', colors: { background: '#f4f7f2', surface: '#e6eee2', text: '#1d291c', muted: '#596858', accent: '#2f6b3c', border: '#c7d3c3' } },
  midnight: { label: 'Midnight', appearance: 'dark', colors: { background: '#111827', surface: '#1f2937', text: '#f3f4f6', muted: '#b8c0cc', accent: '#7dd3fc', border: '#374151' } },
  charcoal: { label: 'Charcoal', appearance: 'dark', colors: { background: '#181817', surface: '#262624', text: '#f5f5f0', muted: '#bebdb4', accent: '#f0b35b', border: '#44443f' } },
} as const satisfies Record<string, { label: string; appearance: BlogDesignSpecV2['theme']['appearance']; colors: ThemeColors }>;

export type ThemePaletteName = keyof typeof THEME_PALETTES;
export interface ThemeControlValues {
  preset: BlogDesignSpecV2['theme']['motif']; palette: ThemePaletteName | null;
  bodyFont: BlogDesignSpecV2['theme']['typography']['bodyFont']; headingFont: BlogDesignSpecV2['theme']['typography']['headingFont']; scale: BlogDesignSpecV2['theme']['typography']['scale'];
  contentWidth: BlogDesignSpecV2['theme']['layout']['contentWidth']; density: BlogDesignSpecV2['theme']['layout']['density']; radius: BlogDesignSpecV2['theme']['layout']['radius'];
  headerStyle: BlogDesignSpecV2['chrome']['header']['variant']; footerStyle: BlogDesignSpecV2['chrome']['footer']['variant'];
  homeLayout: BlogDesignSpecV2['pages']['home']['layout']; postListStyle: BlogDesignSpecV2['pages']['index']['item']['variant']; indexLayout: BlogDesignSpecV2['pages']['index']['layout'];
  articleLayout: BlogDesignSpecV2['pages']['article']['layout']; articleToc: 'auto-inline' | 'auto-aside' | 'hidden'; articleHeader: BlogDesignSpecV2['pages']['article']['header']['variant']; articleMetadata: 'compact' | 'detailed'; articleNavigation: 'links' | 'cards'; codeBlockStyle: BlogDesignSpecV2['pages']['article']['prose']['codeBlock'];
}

const OPTIONS = {
  preset: ['minimal', 'editorial', 'notebook'], bodyFont: ['system-sans', 'system-serif', 'system-mono'], headingFont: ['system-sans', 'system-serif', 'system-mono'], scale: ['compact', 'comfortable', 'large'], contentWidth: ['narrow', 'medium', 'wide'], density: ['compact', 'comfortable'], radius: ['none', 'soft', 'round'],
  headerStyle: ['compact', 'centered', 'masthead'], footerStyle: ['minimal', 'profile'], homeLayout: ['stack', 'sidebar', 'magazine'], postListStyle: ['divided', 'cards', 'numbered'], indexLayout: ['list', 'grid', 'magazine'], articleLayout: ['reading', 'wide', 'with-aside'], articleToc: ['auto-inline', 'auto-aside', 'hidden'], articleHeader: ['simple', 'editorial'], articleMetadata: ['compact', 'detailed'], articleNavigation: ['links', 'cards'], codeBlockStyle: ['plain', 'panel'], columns: ['1', '2', '3'], boolean: ['true', 'false'],
} as const;
export const PRESENTATION_OPTIONS = {
  emphasis: ['', 'subtle', 'normal', 'strong'], width: ['', 'reading', 'content', 'full'], align: ['', 'start', 'center'], surface: ['', 'plain', 'soft', 'prominent'], density: ['', 'compact', 'comfortable', 'relaxed'], spacing: ['', 'none', 'tight', 'normal', 'relaxed', 'spacious'], frame: ['', 'none', 'subtle', 'strong'],
} as const;

function stringValue(input: Record<string, unknown>, key: string): string | undefined { return typeof input[key] === 'string' ? input[key] : undefined; }
function enumValue<const T extends readonly string[]>(input: Record<string, unknown>, key: string, allowed: T): T[number] { const value = stringValue(input, key); if (!value || !allowed.includes(value)) throw new Error(`Invalid design control: ${key}`); return value as T[number]; }
function numericValue(input: Record<string, unknown>, key: string, allowed: readonly number[], fallback: number): number { const raw = stringValue(input, key); if (raw === undefined) return fallback; const value = Number(raw); if (!allowed.includes(value)) throw new Error(`Invalid design control: ${key}`); return value; }
function exactColors(first: ThemeColors, second: ThemeColors): boolean { return (Object.keys(first) as (keyof ThemeColors)[]).every((key) => first[key].toLowerCase() === second[key].toLowerCase()); }
export function paletteForTheme(design: BlogDesignSpecV2): ThemePaletteName | null {
  for (const [name, palette] of Object.entries(THEME_PALETTES) as [ThemePaletteName, (typeof THEME_PALETTES)[ThemePaletteName]][]) if (design.theme.appearance === palette.appearance && exactColors(design.theme.colors, palette.colors)) return name;
  return null;
}
function articleModule(design: BlogDesignSpecV2, type: BlogDesignSpecV2['pages']['article']['modules'][string]['type']) {
  return Object.entries(design.pages.article.modules).find(([, module]) => module.type === type);
}
export function themeControlValues(design: BlogDesignSpecV2): ThemeControlValues {
  const toc = articleModule(design, 'toc');
  const metadata = articleModule(design, 'metadata');
  const navigation = articleModule(design, 'navigation');
  return {
    preset: design.theme.motif, palette: paletteForTheme(design), ...design.theme.typography, ...design.theme.layout,
    headerStyle: design.chrome.header.variant, footerStyle: design.chrome.footer.variant, homeLayout: design.pages.home.layout,
    postListStyle: design.pages.index.item.variant, indexLayout: design.pages.index.layout,
    articleLayout: design.pages.article.layout,
    articleToc: !toc ? 'hidden' : toc[1].type === 'toc' && toc[1].variant === 'aside' ? 'auto-aside' : 'auto-inline',
    articleHeader: design.pages.article.header.variant,
    articleMetadata: metadata?.[1].type === 'metadata' ? metadata[1].variant : 'compact',
    articleNavigation: navigation?.[1].type === 'navigation' ? navigation[1].variant : 'links',
    codeBlockStyle: design.pages.article.prose.codeBlock,
  };
}

export function hasUnsavedFineTuneChanges(design: BlogDesignSpecV2, input: Record<string, unknown>): boolean {
  const controls = themeControlValues(design);
  const expected: Record<string, string> = {
    preset: controls.preset, bodyFont: controls.bodyFont, headingFont: controls.headingFont, scale: controls.scale,
    contentWidth: controls.contentWidth, density: controls.density, radius: controls.radius,
    headerStyle: controls.headerStyle, footerStyle: controls.footerStyle, homeLayout: controls.homeLayout,
    postListStyle: controls.postListStyle, indexLayout: controls.indexLayout,
    indexColumns: String(design.pages.index.columns ?? 1),
    indexShowDescription: String(design.pages.index.item.showDescription), indexShowTags: String(design.pages.index.item.showTags),
    articleLayout: controls.articleLayout, articleToc: controls.articleToc, articleHeader: controls.articleHeader,
    articleMetadata: controls.articleMetadata, articleNavigation: controls.articleNavigation, codeBlockStyle: controls.codeBlockStyle,
  };
  if (controls.palette) expected.palette = controls.palette;
  for (const [id, section] of Object.entries(design.pages.home.sections)) {
    const prefix = `home:${id}:`;
    const region = Object.entries(design.pages.home.regions).find(([, ids]) => ids.includes(id))?.[0];
    if (!region) return true;
    expected[`${prefix}region`] = region;
    expected[`${prefix}variant`] = section.variant;
    if (section.type === 'intro') expected[`${prefix}showAuthor`] = String(section.showAuthor);
    if (section.type === 'posts') {
      expected[`${prefix}source`] = section.source.strategy;
      expected[`${prefix}limit`] = String(section.limit);
      expected[`${prefix}columns`] = String(section.columns ?? 1);
    }
    if (section.type === 'topics') expected[`${prefix}limit`] = String(section.limit);
  }
  const presentations: Record<string, PresentationSpec | undefined> = {
    'chrome.header': design.chrome.header.presentation, 'chrome.footer': design.chrome.footer.presentation,
    home: design.pages.home.presentation, index: design.pages.index.presentation, 'index.item': design.pages.index.item.presentation,
    article: design.pages.article.presentation, 'article.header': design.pages.article.header.presentation, 'article.prose': design.pages.article.prose.presentation,
  };
  for (const [id, section] of Object.entries(design.pages.home.sections)) presentations[`home.${id}`] = section.presentation;
  for (const [id, module] of Object.entries(design.pages.article.modules)) presentations[`article.${id}`] = module.presentation;
  for (const [path, presentation] of Object.entries(presentations)) {
    for (const field of Object.keys(PRESENTATION_OPTIONS) as (keyof PresentationSpec)[]) expected[`presentation:${path}:${field}`] = presentation?.[field] ?? '';
  }
  for (const [name, value] of Object.entries(expected)) if (input[name] !== value) return true;
  return !controls.palette && typeof input.palette === 'string';
}
const LABELS = { preset: { minimal: 'Minimal', editorial: 'Editorial', notebook: 'Notebook' }, bodyFont: { 'system-sans': 'Sans', 'system-serif': 'Serif', 'system-mono': 'Mono' }, headingFont: { 'system-sans': 'Sans', 'system-serif': 'Serif', 'system-mono': 'Mono' }, scale: { compact: 'Compact', comfortable: 'Medium', large: 'Large' }, headerStyle: { compact: 'Compact header', centered: 'Centered header', masthead: 'Masthead' }, postListStyle: { divided: 'Divided list', cards: 'Cards', numbered: 'Numbered list' }, codeBlockStyle: { plain: 'Plain code', panel: 'Code panel' } } as const;
export function describeTheme(design: BlogDesignSpecV2): string { const palette = paletteForTheme(design); return `${LABELS.preset[design.theme.motif]} · ${palette ? THEME_PALETTES[palette].label : 'AI palette'} · ${LABELS.bodyFont[design.theme.typography.bodyFont]} / ${LABELS.headingFont[design.theme.typography.headingFont]} · ${LABELS.scale[design.theme.typography.scale]} · ${LABELS.headerStyle[design.chrome.header.variant]} · ${LABELS.postListStyle[design.pages.index.item.variant]} · ${LABELS.codeBlockStyle[design.pages.article.prose.codeBlock]}`; }

function updatePresentation(node: { presentation?: PresentationSpec }, path: string, input: Record<string, unknown>): void {
  const next = { ...node.presentation };
  for (const [field, allowed] of Object.entries(PRESENTATION_OPTIONS) as [keyof PresentationSpec, readonly string[]][]) {
    const raw = stringValue(input, `presentation:${path}:${field}`);
    if (raw === undefined) continue;
    if (!allowed.includes(raw)) throw new Error(`Invalid design control: presentation:${path}:${field}`);
    if (raw) Object.assign(next, { [field]: raw }); else Reflect.deleteProperty(next, field);
  }
  if (Object.keys(next).length) node.presentation = next;
  else delete node.presentation;
}
function applyPresentations(design: BlogDesignSpecV2, input: Record<string, unknown>): void {
  updatePresentation(design.chrome.header, 'chrome.header', input);
  updatePresentation(design.chrome.footer, 'chrome.footer', input);
  updatePresentation(design.pages.home, 'home', input);
  for (const [id, section] of Object.entries(design.pages.home.sections)) updatePresentation(section, `home.${id}`, input);
  updatePresentation(design.pages.index, 'index', input);
  updatePresentation(design.pages.index.item, 'index.item', input);
  updatePresentation(design.pages.article, 'article', input);
  updatePresentation(design.pages.article.header, 'article.header', input);
  updatePresentation(design.pages.article.prose, 'article.prose', input);
  for (const [id, module] of Object.entries(design.pages.article.modules)) updatePresentation(module, `article.${id}`, input);
}
function regionsFor(layout: BlogDesignSpecV2['pages']['home']['layout'], ids: string[]) {
  if (layout === 'stack') return { main: ids };
  if (layout === 'sidebar') return { main: ids, aside: [] as string[] };
  return { lead: [] as string[], main: ids, rail: [] as string[] };
}
function editHome(design: BlogDesignSpecV2, input: Record<string, unknown>): void {
  const home = design.pages.home;
  const layout = enumValue(input, 'homeLayout', OPTIONS.homeLayout);
  if (layout !== home.layout) {
    const ids = Object.values(home.regions).flat();
    design.pages.home = { ...home, layout, regions: regionsFor(layout, ids) } as BlogDesignSpecV2['pages']['home'];
  }
  const current = design.pages.home;
  for (const [id, section] of Object.entries(current.sections)) {
    const prefix = `home:${id}:`;
    const variant = stringValue(input, `${prefix}variant`);
    if (variant) Object.assign(section, { variant });
    if (section.type === 'intro') {
      const raw = stringValue(input, `${prefix}showAuthor`);
      if (raw !== undefined) section.showAuthor = enumValue(input, `${prefix}showAuthor`, OPTIONS.boolean) === 'true';
    }
    if (section.type === 'posts') {
      section.limit = numericValue(input, `${prefix}limit`, [1, 2, 3, 5, 6, 9], section.limit) as typeof section.limit;
      const columns = stringValue(input, `${prefix}columns`);
      if (section.variant === 'grid') {
        const parsed = columns === undefined ? section.columns : numericValue(input, `${prefix}columns`, [1, 2, 3], section.columns ?? 2);
        section.columns = parsed === 3 ? 3 : 2;
      } else if (section.variant === 'list') section.columns = 1;
      else if (columns !== undefined) section.columns = numericValue(input, `${prefix}columns`, [1, 2, 3], section.columns ?? 1) as 1 | 2 | 3;
      const strategy = stringValue(input, `${prefix}source`);
      if (strategy) section.source = { strategy: enumValue(input, `${prefix}source`, ['latest', 'recently-updated']) };
    }
    if (section.type === 'topics') section.limit = numericValue(input, `${prefix}limit`, [6, 12, 24], section.limit) as typeof section.limit;
  }
  for (const id of Object.keys(current.sections)) {
    const destination = stringValue(input, `home:${id}:region`);
    if (!destination) continue;
    if (!Object.hasOwn(current.regions, destination)) {
      if (layout !== home.layout) continue;
      throw new Error('Invalid homepage region');
    }
    for (const ids of Object.values(current.regions)) {
      const at = ids.indexOf(id);
      if (at >= 0) ids.splice(at, 1);
    }
    current.regions[destination as keyof typeof current.regions]?.push(id);
  }
  const action = stringValue(input, 'compositionAction');
  if (!action) return;
  const [kind, id] = action.split(':');
  if (kind === 'add') {
    const type = enumValue(input, 'addSectionType', ['intro', 'posts', 'topics', 'author']);
    const baseId = type === 'posts' ? 'posts' : type;
    let nextId = baseId;
    for (let suffix = 2; Object.hasOwn(current.sections, nextId); suffix += 1) nextId = `${baseId}-${String(suffix)}`;
    const section = type === 'intro' ? { type, variant: 'minimal', showAuthor: true } as const
      : type === 'posts' ? { type, source: { strategy: 'latest' }, variant: 'list', limit: 5 } as const
        : type === 'topics' ? { type, variant: 'list', limit: 12 } as const : { type, variant: 'compact' } as const;
    current.sections[nextId] = section;
    current.regions.main.push(nextId);
  } else if (id && Object.hasOwn(current.sections, id)) {
    const ids = Object.values(current.regions).find((region) => region.includes(id));
    if (!ids) throw new Error('Homepage section has no region');
    const at = ids.indexOf(id);
    if (kind === 'remove') { ids.splice(at, 1); Reflect.deleteProperty(current.sections, id); }
    if (kind === 'up' && at > 0) {
      const previous = ids[at - 1]; const selected = ids[at];
      if (previous && selected) { ids[at - 1] = selected; ids[at] = previous; }
    }
    if (kind === 'down' && at < ids.length - 1) {
      const selected = ids[at]; const following = ids[at + 1];
      if (selected && following) { ids[at] = following; ids[at + 1] = selected; }
    }
  } else throw new Error('Invalid homepage composition action');
}
function editArticle(design: BlogDesignSpecV2, input: Record<string, unknown>): void {
  const article = design.pages.article;
  article.layout = enumValue(input, 'articleLayout', OPTIONS.articleLayout);
  article.header.variant = enumValue(input, 'articleHeader', OPTIONS.articleHeader);
  article.prose.codeBlock = enumValue(input, 'codeBlockStyle', OPTIONS.codeBlockStyle);
  const metadata = articleModule(design, 'metadata');
  if (metadata?.[1].type === 'metadata') metadata[1].variant = enumValue(input, 'articleMetadata', OPTIONS.articleMetadata);
  const navigation = articleModule(design, 'navigation');
  if (navigation?.[1].type === 'navigation') navigation[1].variant = enumValue(input, 'articleNavigation', OPTIONS.articleNavigation);
  const toc = articleModule(design, 'toc');
  const placement = enumValue(input, 'articleToc', OPTIONS.articleToc);
  if (placement === 'hidden') {
    if (toc) {
      Reflect.deleteProperty(article.modules, toc[0]);
      for (const ids of Object.values(article.regions)) {
        const at = ids.indexOf(toc[0]); if (at >= 0) ids.splice(at, 1);
      }
    }
  } else {
    let id = toc?.[0] ?? 'toc';
    if (!toc) for (let suffix = 2; Object.hasOwn(article.modules, id); suffix += 1) id = `toc-${String(suffix)}`;
    article.modules[id] = { type: 'toc', variant: placement === 'auto-aside' ? 'aside' : 'inline', ...(toc?.[1].presentation ? { presentation: toc[1].presentation } : {}) };
    for (const ids of Object.values(article.regions)) {
      const at = ids.indexOf(id); if (at >= 0) ids.splice(at, 1);
    }
    (placement === 'auto-aside' ? article.regions.aside : article.regions.beforeBody).push(id);
  }
}
export function themeFromControls(base: BlogDesignSpecV2, input: Record<string, unknown>): BlogDesignSpecV2 {
  const next = structuredClone(base);
  const paletteName = stringValue(input, 'palette');
  const palette = paletteName ? THEME_PALETTES[paletteName as ThemePaletteName] : undefined;
  if (paletteName && !palette) throw new Error('Invalid design control: palette');
  next.theme = {
    motif: enumValue(input, 'preset', OPTIONS.preset),
    appearance: palette?.appearance ?? base.theme.appearance,
    colors: palette ? { ...palette.colors } : { ...base.theme.colors },
    typography: { bodyFont: enumValue(input, 'bodyFont', OPTIONS.bodyFont), headingFont: enumValue(input, 'headingFont', OPTIONS.headingFont), scale: enumValue(input, 'scale', OPTIONS.scale) },
    layout: { contentWidth: enumValue(input, 'contentWidth', OPTIONS.contentWidth), density: enumValue(input, 'density', OPTIONS.density), radius: enumValue(input, 'radius', OPTIONS.radius) },
  };
  next.chrome.header.variant = enumValue(input, 'headerStyle', OPTIONS.headerStyle);
  next.chrome.footer.variant = enumValue(input, 'footerStyle', OPTIONS.footerStyle);
  editHome(next, input);
  next.pages.index.layout = enumValue(input, 'indexLayout', OPTIONS.indexLayout);
  const indexColumns = numericValue(input, 'indexColumns', [1, 2, 3], next.pages.index.columns ?? 1);
  next.pages.index.columns = next.pages.index.layout === 'grid' ? (indexColumns === 3 ? 3 : 2) : next.pages.index.layout === 'list' ? 1 : indexColumns as 1 | 2 | 3;
  next.pages.index.item.variant = enumValue(input, 'postListStyle', OPTIONS.postListStyle);
  next.pages.index.item.showDescription = enumValue(input, 'indexShowDescription', OPTIONS.boolean) === 'true';
  next.pages.index.item.showTags = enumValue(input, 'indexShowTags', OPTIONS.boolean) === 'true';
  editArticle(next, input);
  applyPresentations(next, input);
  next.description = describeTheme(next);
  return normalizeDesignV2(validateBlogDesignSpecV2(next));
}
export function visualThemeFromControls(base: BlogDesignSpecV2, input: Record<string, unknown>): BlogDesignSpecV2 {
  const candidate = themeFromControls(base, input);
  const visual = structuredClone(base);
  visual.theme = candidate.theme;
  visual.chrome.header.presentation = candidate.chrome.header.presentation;
  visual.chrome.footer.presentation = candidate.chrome.footer.presentation;
  visual.pages.home.presentation = candidate.pages.home.presentation;
  for (const [id, section] of Object.entries(visual.pages.home.sections)) section.presentation = candidate.pages.home.sections[id]?.presentation;
  visual.pages.index.presentation = candidate.pages.index.presentation;
  visual.pages.index.item.presentation = candidate.pages.index.item.presentation;
  visual.pages.article.presentation = candidate.pages.article.presentation;
  visual.pages.article.header.presentation = candidate.pages.article.header.presentation;
  visual.pages.article.prose.presentation = candidate.pages.article.prose.presentation;
  for (const [id, module] of Object.entries(visual.pages.article.modules)) module.presentation = candidate.pages.article.modules[id]?.presentation;
  visual.description = describeTheme(visual);
  return normalizeDesignV2(validateBlogDesignSpecV2(visual));
}
export function themesEqual(first: BlogDesignSpecV2, second: BlogDesignSpecV2): boolean { return JSON.stringify(normalizeDesignV2(first)) === JSON.stringify(normalizeDesignV2(second)); }
