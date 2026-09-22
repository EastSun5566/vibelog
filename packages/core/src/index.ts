export { DevBuilder, createDevBuilder, buildBlog, buildFromVibelog, writeSourceSnapshot } from './core/builder.js';
export type { DevBuilderOptions, BuildOptions, BuildContentSummary, BuildPostSummary, BuildPostTag, CompileBlogOptions } from './core/builder.js';

export { loadConfig } from './core/config.js';
export type { VibelogConfig } from './types.js';

export { Logger, logger, createLogger } from './core/logger.js';

export { generateSlug, slugify } from './core/utils.js';

export {
  HackMdSource,
  HackMdSourceError,
  isHackMdSourceError,
} from './adapters/content/index.js';
export type { HackMdSourceErrorCode } from './adapters/content/index.js';

export {
  AiProviderRequestError,
  AiProviderTimeoutError,
  FallbackAiProvider,
  PiAiProvider,
  createAiProvider,
  createAiProviderChain,
  getAiProviderNames,
} from './adapters/ai/index.js';
export type { AiProviderFailureKind, AiProviderRequestErrorOptions } from './adapters/ai/index.js';

export type {
  Post,
  PostsResponse,
  Author,
  AuthorResponse,
  ContentSource,
  ThemeConfig,
  AiGenerationContext,
  ThemeColors,
  ThemeHeaderStyle,
  ThemePostListStyle,
  ThemeCodeBlockStyle,
  AiProvider,
} from './types.js';

export { DEFAULT_THEME, contrastRatio, validateThemeConfig, renderThemeCss } from './theme.js';
export { DESIGN_CATALOG, DESIGN_CATALOG_INSTRUCTIONS } from './design/catalog.js';
export { DEFAULT_DESIGN } from './design/defaults.js';
export { migrateThemeConfigToDesign, parsePersistedDesign } from './design/migrate.js';
export { createContentProfile } from './design/profile.js';
export { normalizeDesignDecoration } from './design/normalize.js';
export { renderDesignCss, designToLegacyTheme } from './design/styles.js';
export { blogDesignSpecV1Schema, contentProfileSchema, parseBlogDesignSpec, sourceSnapshotV1Schema, validateBlogDesignSpec, validateSourceSnapshot } from './design/validate.js';
export type { BlogDesignSpec, BlogDesignSpecV1, ContentProfile, DesignProposalInput, HomeSection, SourceSnapshotV1, StyleRule, StyleTarget } from './design/types.js';
export { sanitizeMarkdown } from './markdown.js';

export { ContentSourceName } from './consts.js';
