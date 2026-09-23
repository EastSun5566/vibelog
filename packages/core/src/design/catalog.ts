export const DESIGN_CATALOG = {
  purpose:
    'Describe how a production VibeLog is presented. Content, routes, search, feeds, SEO, and Markdown behavior remain VibeLog-owned.',
  theme: {
    motif: {
      minimal: 'quiet and direct',
      editorial: 'publication-like hierarchy',
      notebook: 'personal and technical',
    },
    appearance: ['light', 'dark'],
    fonts: ['system-sans', 'system-serif', 'system-mono'],
    scale: ['compact', 'comfortable', 'large'],
    contentWidth: ['narrow', 'medium', 'wide'],
    density: ['compact', 'comfortable'],
    radius: ['none', 'soft', 'round'],
    colors: 'Exactly six #RRGGBB colors. Text and accent must each have 4.5 contrast against background.',
  },
  chrome: {
    header: {
      purpose: 'Site identity and VibeLog-owned navigation',
      variants: {
        compact: 'single restrained row',
        centered: 'centered identity and navigation',
        masthead: 'strong publication header',
      },
    },
    footer: {
      purpose: 'Copyright and machine-readable links',
      variants: {
        minimal: 'compact utility footer',
        profile: 'more prominent synced author identity',
      },
    },
  },
  homeSections: {
    intro: {
      purpose: 'Synced site title and description',
      variants: ['minimal', 'centered', 'split'],
      properties: { showAuthor: 'boolean' },
    },
    featuredPosts: {
      purpose: 'Newest included posts; selection is deterministic',
      variants: ['hero', 'split'],
      properties: { count: [1, 2] },
    },
    recentPosts: {
      purpose: 'Newest posts not already featured',
      variants: ['list', 'cards', 'grid'],
      properties: { limit: [3, 5, 6, 9], columns: [1, 2, 3] },
      constraints: 'list allows absent/1 columns; grid requires 2/3 columns',
    },
    topics: {
      purpose: 'Topics derived from synced tags; disappears when empty',
      variants: ['list', 'cloud'],
      properties: { limit: [6, 12, 24] },
    },
    author: {
      purpose: 'Synced author identity',
      variants: ['compact', 'profile'],
    },
    constraints: 'Use 1-5 unique section types and include featured-posts or recent-posts.',
  },
  index: {
    purpose: 'Paginated post archive; routing and page size are fixed',
    layouts: ['list', 'grid', 'magazine'],
    itemVariants: ['divided', 'cards', 'numbered'],
    columns: [1, 2, 3],
    constraints: 'list allows absent/1 columns; grid requires 2/3 columns',
  },
  article: {
    purpose: 'Article framing around VibeLog-rendered Markdown',
    layouts: ['reading', 'wide', 'with-aside'],
    headers: ['simple', 'editorial'],
    toc: ['auto-inline', 'auto-aside', 'hidden'],
    metadata: ['compact', 'detailed'],
    navigation: ['links', 'cards'],
    codeBlock: ['plain', 'panel'],
    constraints: 'auto-aside TOC requires with-aside layout',
  },
  styleRules: {
    purpose: 'Optional semantic adjustments compiled to VibeLog-owned CSS tokens',
    max: 8,
    targets: [
      'site.header',
      'home.intro',
      'home.sections',
      'posts.items',
      'article.header',
      'article.prose',
      'article.toc',
      'site.footer',
    ],
    declarations: {
      textAlign: ['start', 'center'],
      paddingBlock: ['none', 'sm', 'md', 'lg', 'xl'],
      gap: ['sm', 'md', 'lg', 'xl'],
      surface: ['transparent', 'background', 'surface'],
      border: ['none', 'hairline', 'strong'],
      width: ['reading', 'content', 'full'],
    },
    constraints:
      'Each target may appear at most once. Use only the few adjustments that serve a clear hierarchy, usually 0-3 rules. Post items and the article table of contents already own their borders and surfaces. The footer, masthead, and editorial headers already own their borders. Never emit selectors, CSS, numeric values, URLs, animation, positioning, or fonts.',
  },
} as const;

export const DESIGN_CATALOG_INSTRUCTIONS = `Use only the BlogDesignSpec vocabulary in this catalog. Choose blog presentation, not capabilities. Give the site one memorable visual idea; use balanced whitespace and a clear title-to-body hierarchy. Keep secondary decoration quiet and never repeat a border or surface already supplied by a variant. Do not emit HTML, CSS, JavaScript, URLs, file paths, routes, content, imports, or component names outside the catalog.\n${JSON.stringify(DESIGN_CATALOG)}`;
