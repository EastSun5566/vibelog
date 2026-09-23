import type { BlogDesignSpecV1, StyleRule } from './types.js';

/** Keep each region's built-in treatment as its single visual boundary. */
export function normalizeDesignDecoration(design: BlogDesignSpecV1): BlogDesignSpecV1 {
  const rules = design.styles.rules.flatMap((rule): StyleRule[] => {
    const declarations = { ...rule.declarations };
    if (rule.target === 'posts.items') {
      delete declarations.border;
      delete declarations.surface;
    }
    if (rule.target === 'article.toc') {
      delete declarations.border;
      delete declarations.surface;
    }
    if (rule.target === 'site.footer') {
      delete declarations.border;
    }
    if (rule.target === 'site.header' && (design.theme.motif === 'editorial' || design.chrome.header.variant === 'masthead')) {
      delete declarations.border;
    }
    if (rule.target === 'article.header' && design.pages.article.header === 'editorial') {
      delete declarations.border;
    }
    return Object.keys(declarations).length ? [{ target: rule.target, declarations }] : [];
  });
  return { ...design, styles: { rules } };
}
