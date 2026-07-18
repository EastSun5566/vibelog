// Core builders
export { DevBuilder, createDevBuilder, buildFromVibelog } from './core/builder.js';
export type { DevBuilderOptions, BuildOptions } from './core/builder.js';

// Configuration
export { loadConfig } from './core/config.js';
export type { VibelogConfig } from './types.js';

// Logger
export { Logger, logger, createLogger } from './core/logger.js';

// Utilities
export { generateSlug, slugify } from './core/utils.js';

// Adapters - Content
export {
  HackMdSource,
} from './adapters/content/index.js';

// Adapters - AI
export {
  PiAiProvider,
  createAiProvider,
  getAiProviderNames,
} from './adapters/ai/index.js';

// Types & Interfaces
export type {
  Post,
  PostsResponse,
  Author,
  AuthorResponse,
  ContentSource,
  ThemeConfig,
  ThemeProposalInput,
  ThemeColors,
  AiProvider,
} from './types.js';

export { DEFAULT_THEME, contrastRatio, validateThemeConfig, renderThemeCss } from './theme.js';
export { sanitizeMarkdown } from './markdown.js';

// Constants
export { ContentSourceName } from './consts.js';
