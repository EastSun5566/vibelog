import { renderThemeCss } from '../theme.js';
import type { ThemeConfig } from '../types.js';
import type { BlogDesignSpecV1, StyleRule } from './types.js';
import { validateBlogDesignSpec } from './validate.js';

const TARGETS: Record<StyleRule['target'], string> = {
  'site.header': '[data-design-target="site.header"]',
  'home.intro': '[data-design-target="home.intro"]',
  'home.sections': '[data-design-target="home.sections"]',
  'posts.items': '[data-design-target="posts.items"]',
  'article.header': '[data-design-target="article.header"]',
  'article.prose': '[data-design-target="article.prose"]',
  'article.toc': '[data-design-target="article.toc"]',
  'site.footer': '[data-design-target="site.footer"]',
};
const SPACE = { none: '0', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2.5rem' };
const WIDTH = { reading: '42rem', content: 'var(--theme-content-width)', full: '100%' };
const MOTIF_STYLES = {
  minimal: `.article-navigation-link{border-top:1px solid var(--theme-border)}`,
  editorial: `h1,h2,h3{letter-spacing:-.045em}.site-header{border-bottom:3px double var(--theme-border)}.article-navigation-link{border-top:3px double var(--theme-border)}`,
  notebook: `body{background-image:linear-gradient(var(--theme-border) 1px,transparent 1px);background-size:100% 1.75rem}.site-header nav,main,.site-footer,footer{background:var(--theme-background)}.article-navigation-link{background:var(--theme-surface);border:1px solid var(--theme-border);border-radius:var(--theme-radius);padding:var(--theme-space)}`,
} as const;
const HEADER_VARIANTS = `.site-header.variant-compact nav{min-height:4rem}
.site-header.variant-centered nav{flex-direction:column;justify-content:center;padding-block:calc(var(--theme-space)*1.15);text-align:center}.site-header.variant-centered .site-title{font-size:clamp(1.2rem,3vw,1.65rem)}.site-header.variant-centered .site-nav-links{justify-content:center}
.site-header.variant-masthead nav{border-block:3px double var(--theme-border);padding-block:calc(var(--theme-space)*1.5)}`;
const POST_LIST_VARIANTS = `.blog-list.variant-divided{gap:0}.blog-list.variant-divided .blog-list-item{background:transparent;border:0;border-bottom:1px solid var(--theme-border);border-radius:0;padding:var(--theme-space) 0}.blog-list.variant-divided .blog-list-item:first-child{border-top:1px solid var(--theme-border)}
.blog-list.variant-cards{gap:var(--theme-space)}.blog-list.variant-cards .blog-list-item{background:var(--theme-surface);border:1px solid var(--theme-border);border-radius:var(--theme-radius);padding:var(--theme-space)}
.blog-list.variant-numbered{counter-reset:vibelog-posts}.blog-list.variant-numbered .blog-list-item{align-items:start;background:transparent;border:0;border-bottom:1px solid var(--theme-border);border-radius:0;counter-increment:vibelog-posts;display:grid;gap:var(--theme-space);grid-template-columns:2.5rem minmax(0,1fr);padding:var(--theme-space) 0}.blog-list.variant-numbered .blog-list-item::before{color:var(--theme-muted);content:counter(vibelog-posts,decimal-leading-zero);font-family:var(--theme-heading-font);font-size:.8rem;padding-block-start:.2rem}`;
const CODE_BLOCK_VARIANTS = `.blog-post.code-plain .prose pre{border-color:transparent;border-inline-start:.2rem solid var(--theme-border);border-radius:0}
.blog-post.code-panel .prose pre{border:1px solid var(--theme-border);border-radius:var(--theme-radius);box-shadow:0 .4rem 1.2rem rgb(0 0 0/.06)}`;

function ruleCss(rule: StyleRule): string {
  const declarations = rule.declarations;
  const css = [
    declarations.textAlign && `text-align:${declarations.textAlign}`,
    declarations.paddingBlock && `padding-block:${SPACE[declarations.paddingBlock]}`,
    declarations.gap && `gap:${SPACE[declarations.gap]}`,
    declarations.surface && `background:${declarations.surface === 'transparent' ? 'transparent' : `var(--theme-${declarations.surface})`}`,
    declarations.border && `border:${declarations.border === 'none' ? '0' : `${declarations.border === 'strong' ? '3px' : '1px'} solid var(--theme-border)`}`,
    declarations.width && `max-width:${WIDTH[declarations.width]}`,
  ].filter(Boolean).join(';');
  return css ? `${TARGETS[rule.target]}{${css}}` : '';
}

export function designToLegacyTheme(design: BlogDesignSpecV1): ThemeConfig {
  return {
    preset: design.theme.motif,
    appearance: design.theme.appearance,
    colors: design.theme.colors,
    bodyFont: design.theme.typography.bodyFont,
    headingFont: design.theme.typography.headingFont,
    scale: design.theme.typography.scale,
    contentWidth: design.theme.layout.contentWidth,
    density: design.theme.layout.density,
    radius: design.theme.layout.radius,
    headerStyle: design.chrome.header.variant === 'masthead' ? 'centered' : design.chrome.header.variant,
    postListStyle: design.pages.index.itemVariant,
    codeBlockStyle: design.pages.article.codeBlock,
    description: design.description,
  };
}

export function renderDesignCss(input: BlogDesignSpecV1): string {
  const design = validateBlogDesignSpec(input);
  return `${renderThemeCss(designToLegacyTheme(design), { includeLegacyVariants: false })}
/* Presentation IR v1 */
${MOTIF_STYLES[design.theme.motif]}
${HEADER_VARIANTS}
${POST_LIST_VARIANTS}
${CODE_BLOCK_VARIANTS}
.site-footer.variant-profile{display:grid;gap:.35rem}
.home-sections{display:grid;gap:clamp(2.5rem,7vw,6rem)}
.home-section.variant-centered{text-align:center}.home-section.variant-split{display:grid;gap:var(--theme-space)}
.featured-posts.variant-hero .blog-item-title{font-size:clamp(1.8rem,5vw,3.4rem)}
.home-author.variant-profile{background:var(--theme-surface);border:1px solid var(--theme-border);border-radius:var(--theme-radius);padding:clamp(1rem,4vw,2rem)}
.home-topics.variant-cloud .home-topic-list{display:flex;flex-wrap:wrap;gap:.65rem;list-style:none;padding:0}
.featured-posts.variant-split .blog-list,.recent-posts.variant-grid .blog-list,.recent-posts.variant-cards .blog-list,.blog-index.layout-grid .blog-list{display:grid;grid-template-columns:repeat(var(--design-columns,2),minmax(0,1fr))}
.blog-index.layout-magazine .blog-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.blog-index.layout-magazine .blog-list-item:first-child{grid-column:1/-1}
.blog-post.layout-wide .blog-post-content{max-width:min(100%,64rem)}.blog-post.layout-with-aside .blog-post-content{display:grid;grid-template-columns:minmax(0,1fr) minmax(12rem,18rem);gap:clamp(1.5rem,4vw,3rem);max-width:min(100%,72rem)}
.blog-post.layout-with-aside .blog-post-header,.blog-post.layout-with-aside .prose,.blog-post.layout-with-aside .article-back-to-start{grid-column:1}.blog-post.layout-with-aside .table-of-contents-placement{grid-column:2;grid-row:1/span 3}
.blog-post-header.variant-editorial{border-block:3px double var(--theme-border);padding-block:calc(var(--theme-space)*1.5)}
.blog-post-description{color:var(--theme-muted);font-size:1.08em;line-height:1.65;max-width:65ch}
.article-navigation.variant-cards .article-navigation-link{background:var(--theme-surface);border:1px solid var(--theme-border);border-radius:var(--theme-radius);padding:var(--theme-space)}
${design.styles.rules.map(ruleCss).filter(Boolean).join('\n')}
@media(max-width:48rem){.featured-posts.variant-split .blog-list,.recent-posts.variant-grid .blog-list,.recent-posts.variant-cards .blog-list,.blog-index.layout-grid .blog-list,.blog-index.layout-magazine .blog-list{grid-template-columns:1fr}.blog-post.layout-with-aside .blog-post-content{display:block}}
`;
}
