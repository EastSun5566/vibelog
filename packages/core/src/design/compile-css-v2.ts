import type { BlogDesignSpecV2, PresentationSpec } from './schema-v2.js';
import { normalizeDesignV2 } from './normalize-v2.js';

const FONT = {
  'system-sans': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'system-serif': 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  'system-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;
const SCALE = { compact: '15px', comfortable: '16px', large: '18px' } as const;
const WIDTH = { narrow: '42rem', medium: '52rem', wide: '66rem' } as const;
const SPACE = { compact: '1rem', comfortable: '1.5rem' } as const;
const RADIUS = { none: '0', soft: '0.5rem', round: '1rem' } as const;
const NODE_WIDTH = { reading: '42rem', content: 'var(--theme-content-width)', full: '100%' } as const;
const NODE_SPACE = { none: '0', tight: '.5rem', normal: '1rem', relaxed: '1.5rem', spacious: '2.5rem' } as const;
const NODE_DENSITY = { compact: '.5rem', comfortable: '1rem', relaxed: '1.5rem' } as const;

function presentationCss(selector: string, presentation: PresentationSpec | undefined): string {
  if (!presentation || Object.keys(presentation).length === 0) return '';
  const declarations = [
    presentation.width && `max-width:${NODE_WIDTH[presentation.width]}`,
    presentation.align && `text-align:${presentation.align}`,
    presentation.surface && `background:${presentation.surface === 'plain' ? 'transparent' : presentation.surface === 'soft' ? 'var(--theme-surface)' : 'color-mix(in srgb,var(--theme-surface) 70%,var(--theme-accent))'}`,
    presentation.density && `padding:${NODE_DENSITY[presentation.density]}`,
    presentation.spacing && `margin-block:${NODE_SPACE[presentation.spacing]}`,
    presentation.frame && `border:${presentation.frame === 'none' ? '0' : presentation.frame === 'strong' ? '2px solid var(--theme-border)' : '1px solid var(--theme-border)'}`,
  ].filter(Boolean);
  const rules = declarations.length ? [`${selector}{${declarations.join(';')}}`] : [];
  if (presentation.emphasis) {
    const weight = presentation.emphasis === 'strong' ? 800 : presentation.emphasis === 'subtle' ? 500 : 700;
    rules.push(`${selector} :is(h1,h2,h3){font-weight:${String(weight)}}`);
  }
  return rules.join('\n');
}

export function compileDesignCss(input: BlogDesignSpecV2): string {
  const design = normalizeDesignV2(input);
  const { theme } = design;
  const rules = [
    `:root{color-scheme:${theme.appearance};--theme-background:${theme.colors.background};--theme-surface:${theme.colors.surface};--theme-text:${theme.colors.text};--theme-muted:${theme.colors.muted};--theme-accent:${theme.colors.accent};--theme-border:${theme.colors.border};--theme-body-font:${FONT[theme.typography.bodyFont]};--theme-heading-font:${FONT[theme.typography.headingFont]};--theme-font-size:${SCALE[theme.typography.scale]};--theme-content-width:${WIDTH[theme.layout.contentWidth]};--theme-space:${SPACE[theme.layout.density]};--theme-radius:${RADIUS[theme.layout.radius]}}`,
    `body{background:var(--theme-background);color:var(--theme-text);font-family:var(--theme-body-font);font-size:var(--theme-font-size)}`,
    `h1,h2,h3,h4,h5,h6{color:var(--theme-text);font-family:var(--theme-heading-font)}`,
    `a{color:var(--theme-accent)}`,
    `.site-header,.site-footer,footer{background:var(--theme-background);border-color:var(--theme-border)}`,
    `.site-header nav,main,.site-footer,footer{box-sizing:border-box;margin-inline:auto;max-width:var(--theme-content-width);padding-inline:var(--theme-space)}`,
    `.site-title,.site-header h2 a,.site-nav-links a{color:var(--theme-text)}`,
    `.site-nav-links a:hover,.site-nav-links a.active,.site-nav-links a[aria-current="page"]{color:var(--theme-accent)}`,
    `small,time,.muted,.eyebrow,.blog-item-description,.blog-item-date,.blog-post-date,.blog-post-update,.article-navigation-link span,.tag-count,.table-of-contents summary::marker{color:var(--theme-muted)}`,
    `.blog-list-item,.blog-post,.article-navigation-link,.tag-link,.tag-index-link,.table-of-contents details{border-color:var(--theme-border)}`,
    `.tag-link,.tag-index-link{background:var(--theme-surface);border-radius:var(--theme-radius);color:var(--theme-accent)}`,
    `.table-of-contents details{background:var(--theme-surface);border-radius:var(--theme-radius)}`,
    `.table-of-contents summary{color:var(--theme-text);font-family:var(--theme-heading-font)}`,
    `.table-of-contents-link,.article-back-to-start{color:var(--theme-accent)}`,
    `pre,code,blockquote,.prose th,.prose td{background:var(--theme-surface);border-color:var(--theme-border);border-radius:var(--theme-radius)}`,
    `.astro-code,.astro-code span{color:var(--shiki-${theme.appearance})!important;background-color:var(--shiki-${theme.appearance}-bg)!important}`,
    `.astro-code code{background:transparent}`,
    `.skip-link{background:var(--theme-text);color:var(--theme-background);border-radius:var(--theme-radius)}`,
  ];
  switch (theme.motif) {
    case 'editorial':
      rules.push('h1,h2,h3{letter-spacing:-.045em}.site-header{border-bottom:3px double var(--theme-border)}');
      break;
    case 'notebook':
      rules.push('body.page-home{background-image:linear-gradient(to bottom,transparent 18rem,var(--theme-background) 36rem),linear-gradient(color-mix(in srgb,var(--theme-border) 15%,transparent) 1px,transparent 1px);background-repeat:no-repeat,repeat;background-size:100% 100%,100% 1.75rem}');
      break;
    default:
      break;
  }
  const homeSelector = (id: string): string => `body.page-home [data-design-node="${id}"]`;
  const articleSelector = (id: string): string => `.blog-post [data-design-node="${id}"]`;
  rules.push(presentationCss('[data-design-role="site-header"]', design.chrome.header.presentation));
  rules.push(presentationCss('[data-design-role="site-footer"]', design.chrome.footer.presentation));
  rules.push(presentationCss('body.page-home [data-design-role="home-root"]', design.pages.home.presentation));
  for (const id of Object.keys(design.pages.home.sections).sort()) {
    rules.push(presentationCss(homeSelector(id), design.pages.home.sections[id]?.presentation));
  }
  rules.push(presentationCss('.blog-index[data-design-role="index-root"]', design.pages.index.presentation));
  rules.push(presentationCss('.blog-index [data-design-role="index-item"]', design.pages.index.item.presentation));
  rules.push(presentationCss('.blog-post[data-design-role="article-root"]', design.pages.article.presentation));
  rules.push(presentationCss(articleSelector('article-header'), design.pages.article.header.presentation));
  rules.push(presentationCss(articleSelector('article-prose'), design.pages.article.prose.presentation));
  for (const id of Object.keys(design.pages.article.modules).sort()) {
    rules.push(presentationCss(articleSelector(id), design.pages.article.modules[id]?.presentation));
  }
  return `${rules.filter(Boolean).join('\n')}\n`;
}
