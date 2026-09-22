import type { ThemeConfig } from '../types.js';
import { validateThemeConfig } from '../theme.js';
import type { BlogDesignSpecV1 } from './types.js';
import { validateBlogDesignSpec } from './validate.js';

export function migrateThemeConfigToDesign(input: ThemeConfig): BlogDesignSpecV1 {
  const theme = validateThemeConfig(input);
  return validateBlogDesignSpec({
    version: 1,
    theme: {
      motif: theme.preset,
      appearance: theme.appearance,
      colors: theme.colors,
      typography: { bodyFont: theme.bodyFont, headingFont: theme.headingFont, scale: theme.scale },
      layout: { contentWidth: theme.contentWidth, density: theme.density, radius: theme.radius },
    },
    chrome: { header: { variant: theme.headerStyle }, footer: { variant: 'minimal' } },
    pages: {
      home: { sections: [{ type: 'intro', variant: theme.headerStyle === 'centered' ? 'centered' : 'minimal', showAuthor: true }, { type: 'recent-posts', variant: theme.postListStyle === 'divided' ? 'list' : 'cards', limit: 5, columns: 1 }] },
      index: { layout: 'list', itemVariant: theme.postListStyle, columns: 1, showDescription: true, showTags: true },
      article: { layout: 'reading', header: 'simple', toc: 'auto-inline', metadata: 'compact', navigation: 'links', codeBlock: theme.codeBlockStyle },
    },
    styles: { rules: [] },
    description: theme.description,
  });
}

export function parsePersistedDesign(input: unknown): BlogDesignSpecV1 {
  if (input && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'version')) return validateBlogDesignSpec(input);
  return migrateThemeConfigToDesign(validateThemeConfig(input));
}
