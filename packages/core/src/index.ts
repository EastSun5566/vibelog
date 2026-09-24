export { DevBuilder, createDevBuilder, buildBlog, buildFromVibelog, writeSourceSnapshot, TEMPLATE_VERSION, SEARCH_SCHEMA_VERSION, searchIndexIdentity, structuralBuildIdentity } from './core/builder.js';
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
  AiGenerationContext,
  ThemeColors,
  AiProvider,
} from './types.js';

export { DEFAULT_DESIGN_V2 } from './design/defaults-v2.js';
export { contrastRatio } from './design/color.js';
export { createContentProfile } from './design/profile.js';
export { contentProfileSchema, sourceSnapshotV1Schema, validateSourceSnapshot } from './design/validate.js';
export type { ContentProfile, DesignProposalInput, SourceSnapshotV1 } from './design/types.js';
export { blogDesignSpecV2Schema, homePageSpecV2Schema, presentationSpecSchema, validateBlogDesignSpecV2 } from './design/schema-v2.js';
export type { BlogDesignSpecV2, DesignNodeId, PresentationSpec } from './design/schema-v2.js';
export { analyzeDesignImpact } from './design/impact-v2.js';
export type { DesignImpact } from './design/impact-v2.js';
export { resolveHomeComposition } from './design/resolve-v2.js';
export type { ResolvablePost, ResolvedHomeComposition, ResolvedHomeSection } from './design/resolve-v2.js';
export { compileDesignCss } from './design/compile-css-v2.js';
export { normalizeDesignV2 } from './design/normalize-v2.js';
export { sanitizeMarkdown } from './markdown.js';

export { ContentSourceName } from './consts.js';
