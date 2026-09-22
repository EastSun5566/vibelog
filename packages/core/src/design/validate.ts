import { z } from 'zod';

import { contrastRatio } from '../theme.js';
import type { BlogDesignSpec, BlogDesignSpecV1, SourceSnapshotV1 } from './types.js';

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const font = z.enum(['system-sans', 'system-serif', 'system-mono']);
const usage = z.enum(['none', 'some', 'frequent']);
export const contentProfileSchema = z.object({
  postCount: z.number().int().nonnegative(),
  tagCount: z.number().int().nonnegative(),
  averageLength: z.enum(['short', 'medium', 'long']),
  codeUsage: usage,
  imageUsage: usage,
  mathUsage: usage,
}).strict();

const intro = z.object({ type: z.literal('intro'), variant: z.enum(['minimal', 'centered', 'split']), showAuthor: z.boolean() }).strict();
const featured = z.object({ type: z.literal('featured-posts'), variant: z.enum(['hero', 'split']), count: z.union([z.literal(1), z.literal(2)]) }).strict();
const recent = z.object({
  type: z.literal('recent-posts'), variant: z.enum(['list', 'cards', 'grid']), limit: z.union([z.literal(3), z.literal(5), z.literal(6), z.literal(9)]), columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
}).strict();
const topics = z.object({ type: z.literal('topics'), variant: z.enum(['list', 'cloud']), limit: z.union([z.literal(6), z.literal(12), z.literal(24)]) }).strict();
const author = z.object({ type: z.literal('author'), variant: z.enum(['compact', 'profile']) }).strict();
const homeSection = z.discriminatedUnion('type', [intro, featured, recent, topics, author]);

const declarations = z.object({
  textAlign: z.enum(['start', 'center']).optional(),
  paddingBlock: z.enum(['none', 'sm', 'md', 'lg', 'xl']).optional(),
  gap: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
  surface: z.enum(['transparent', 'background', 'surface']).optional(),
  border: z.enum(['none', 'hairline', 'strong']).optional(),
  width: z.enum(['reading', 'content', 'full']).optional(),
}).strict();
const styleRule = z.object({
  target: z.enum(['site.header', 'home.intro', 'home.sections', 'posts.items', 'article.header', 'article.prose', 'article.toc', 'site.footer']),
  declarations,
}).strict();

export const blogDesignSpecV1Schema = z.object({
  version: z.literal(1),
  theme: z.object({
    motif: z.enum(['minimal', 'editorial', 'notebook']),
    appearance: z.enum(['light', 'dark']),
    colors: z.object({ background: hex, surface: hex, text: hex, muted: hex, accent: hex, border: hex }).strict(),
    typography: z.object({ bodyFont: font, headingFont: font, scale: z.enum(['compact', 'comfortable', 'large']) }).strict(),
    layout: z.object({ contentWidth: z.enum(['narrow', 'medium', 'wide']), density: z.enum(['compact', 'comfortable']), radius: z.enum(['none', 'soft', 'round']) }).strict(),
  }).strict(),
  chrome: z.object({
    header: z.object({ variant: z.enum(['compact', 'centered', 'masthead']) }).strict(),
    footer: z.object({ variant: z.enum(['minimal', 'profile']) }).strict(),
  }).strict(),
  pages: z.object({
    home: z.object({ sections: z.array(homeSection).min(1).max(5) }).strict(),
    index: z.object({
      layout: z.enum(['list', 'grid', 'magazine']), itemVariant: z.enum(['divided', 'cards', 'numbered']), columns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), showDescription: z.boolean(), showTags: z.boolean(),
    }).strict(),
    article: z.object({
      layout: z.enum(['reading', 'wide', 'with-aside']), header: z.enum(['simple', 'editorial']), toc: z.enum(['auto-inline', 'auto-aside', 'hidden']), metadata: z.enum(['compact', 'detailed']), navigation: z.enum(['links', 'cards']), codeBlock: z.enum(['plain', 'panel']),
    }).strict(),
  }).strict(),
  styles: z.object({ rules: z.array(styleRule).max(8) }).strict(),
  description: z.string().trim().min(1).max(240),
}).strict().superRefine((value, context) => {
  const sectionTypes = value.pages.home.sections.map((section) => section.type);
  if (new Set(sectionTypes).size !== sectionTypes.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', 'home', 'sections'], message: 'Homepage section types must be unique' });
  if (!sectionTypes.some((type) => type === 'featured-posts' || type === 'recent-posts')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', 'home', 'sections'], message: 'Homepage must contain featured or recent posts' });
  const recentSection = value.pages.home.sections.find((section) => section.type === 'recent-posts');
  if (recentSection?.type === 'recent-posts' && recentSection.variant === 'list' && recentSection.columns !== undefined && recentSection.columns !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', 'home', 'sections'], message: 'Recent list columns must be absent or 1' });
  if (recentSection?.type === 'recent-posts' && recentSection.variant === 'grid' && recentSection.columns !== 2 && recentSection.columns !== 3) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', 'home', 'sections'], message: 'Recent grid columns must be 2 or 3' });
  if (value.pages.index.layout === 'list' && value.pages.index.columns !== undefined && value.pages.index.columns !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', 'index', 'columns'], message: 'List columns must be absent or 1' });
  if (value.pages.index.layout === 'grid' && value.pages.index.columns !== 2 && value.pages.index.columns !== 3) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', 'index', 'columns'], message: 'Grid columns must be 2 or 3' });
  if (value.pages.article.toc === 'auto-aside' && value.pages.article.layout !== 'with-aside') context.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', 'article', 'toc'], message: 'Aside TOC requires with-aside article layout' });
  const targets = value.styles.rules.map((rule) => rule.target);
  if (new Set(targets).size !== targets.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['styles', 'rules'], message: 'Style targets must be unique' });
  if (contrastRatio(value.theme.colors.text, value.theme.colors.background) < 4.5) context.addIssue({ code: z.ZodIssueCode.custom, path: ['theme', 'colors', 'text'], message: 'Design text does not have enough contrast against the background' });
  if (contrastRatio(value.theme.colors.accent, value.theme.colors.background) < 4.5) context.addIssue({ code: z.ZodIssueCode.custom, path: ['theme', 'colors', 'accent'], message: 'Design links do not have enough contrast against the background' });
});

export const sourceSnapshotV1Schema = z.object({
  version: z.literal(1),
  site: z.object({ title: z.string(), description: z.string(), language: z.string().min(1) }).strict(),
  author: z.object({ name: z.string(), bio: z.string() }).strict(),
  contentProfile: contentProfileSchema,
}).strict();

export function validateBlogDesignSpec(input: unknown): BlogDesignSpecV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(input, 'version')) throw new Error('Design version is required');
  const version = (input as { version?: unknown }).version;
  if (version !== 1) throw new Error(`Unsupported design version: ${String(version)}`);
  return structuredClone(blogDesignSpecV1Schema.parse(input));
}

export function parseBlogDesignSpec(input: unknown): BlogDesignSpec { return validateBlogDesignSpec(input); }
export function validateSourceSnapshot(input: unknown): SourceSnapshotV1 { return structuredClone(sourceSnapshotV1Schema.parse(input)); }
