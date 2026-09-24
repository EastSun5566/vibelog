// One-time conversion surface; never import from the application runtime.
export { DEFAULT_THEME, contrastRatio, validateThemeConfig, renderThemeCss } from './theme.js';
export { DESIGN_CATALOG, DESIGN_CATALOG_INSTRUCTIONS } from './design/catalog.js';
export { DEFAULT_DESIGN } from './design/defaults.js';
export { migrateThemeConfigToDesign, parsePersistedDesign } from './design/migrate.js';
export { normalizeDesignDecoration } from './design/normalize.js';
export { renderDesignCss, designToLegacyTheme } from './design/styles.js';
export { blogDesignSpecV1Schema, parseBlogDesignSpec, validateBlogDesignSpec } from './design/validate.js';
export type { BlogDesignSpec, BlogDesignSpecV1, HomeSection, StyleRule, StyleTarget } from './design/types.js';
export type { ThemeConfig, ThemeHeaderStyle, ThemePostListStyle, ThemeCodeBlockStyle } from './types.js';
export { migrateDesignV1ToV2, migratePersistedDesignToV2 } from './design/migrate-v2.js';
