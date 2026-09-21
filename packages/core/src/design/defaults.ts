import type { BlogDesignSpecV1 } from './types.js';

export const DEFAULT_DESIGN: BlogDesignSpecV1 = {
  version: 1,
  theme: {
    motif: 'minimal',
    appearance: 'light',
    colors: {
      background: '#ffffff',
      surface: '#f7f7f5',
      text: '#1f2328',
      muted: '#59636e',
      accent: '#075985',
      border: '#d0d7de',
    },
    typography: { bodyFont: 'system-sans', headingFont: 'system-sans', scale: 'comfortable' },
    layout: { contentWidth: 'medium', density: 'comfortable', radius: 'soft' },
  },
  chrome: { header: { variant: 'compact' }, footer: { variant: 'minimal' } },
  pages: {
    home: {
      sections: [
        { type: 'intro', variant: 'minimal', showAuthor: true },
        { type: 'recent-posts', variant: 'list', limit: 5, columns: 1 },
      ],
    },
    index: { layout: 'list', itemVariant: 'divided', columns: 1, showDescription: true, showTags: true },
    article: { layout: 'reading', header: 'simple', toc: 'auto-inline', metadata: 'compact', navigation: 'links', codeBlock: 'plain' },
  },
  styles: { rules: [] },
  description: 'A clear, quiet design that keeps the writing first.',
};
