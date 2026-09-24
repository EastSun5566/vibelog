import { validateBlogDesignSpecV2 } from './schema-v2.js';

export const DEFAULT_DESIGN_V2 = validateBlogDesignSpecV2({
  version: 2,
  theme: {
    motif: 'minimal', appearance: 'light',
    colors: {
      background: '#ffffff', surface: '#f7f7f5', text: '#1f2328',
      muted: '#59636e', accent: '#075985', border: '#d0d7de',
    },
    typography: { bodyFont: 'system-sans', headingFont: 'system-sans', scale: 'comfortable' },
    layout: { contentWidth: 'medium', density: 'comfortable', radius: 'soft' },
  },
  chrome: { header: { variant: 'compact' }, footer: { variant: 'minimal' } },
  pages: {
    home: {
      layout: 'stack',
      sections: {
        intro: { type: 'intro', variant: 'minimal', showAuthor: true },
        recent: { type: 'posts', source: { strategy: 'latest' }, variant: 'list', limit: 5, columns: 1 },
      },
      regions: { main: ['intro', 'recent'] },
    },
    index: { layout: 'list', item: { variant: 'divided', showDescription: true, showTags: true }, columns: 1 },
    article: {
      layout: 'reading', header: { variant: 'simple' },
      modules: {
        metadata: { type: 'metadata', variant: 'compact' },
        tags: { type: 'tags', variant: 'list' },
        toc: { type: 'toc', variant: 'inline' },
        navigation: { type: 'navigation', variant: 'links' },
      },
      regions: { beforeBody: ['metadata', 'tags', 'toc'], aside: [], afterBody: ['navigation'] },
      prose: { codeBlock: 'plain' },
    },
  },
  description: 'A clear, quiet design that keeps the writing first.',
});
