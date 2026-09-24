import { z } from 'zod';

import { contrastRatio } from './color.js';

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);
const oneToThree = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const nodeId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/).refine(
  (value) => !['constructor', 'prototype', '__proto__'].includes(value),
  'Reserved design node ID',
);

export const presentationSpecSchema = z.object({
  emphasis: z.enum(['subtle', 'normal', 'strong']).optional(),
  width: z.enum(['reading', 'content', 'full']).optional(),
  align: z.enum(['start', 'center']).optional(),
  surface: z.enum(['plain', 'soft', 'prominent']).optional(),
  density: z.enum(['compact', 'comfortable', 'relaxed']).optional(),
  spacing: z.enum(['none', 'tight', 'normal', 'relaxed', 'spacious']).optional(),
  frame: z.enum(['none', 'subtle', 'strong']).optional(),
}).strict();

const theme = z.object({
  motif: z.enum(['minimal', 'editorial', 'notebook']),
  appearance: z.enum(['light', 'dark']),
  colors: z.object({
    background: hexColor, surface: hexColor, text: hexColor,
    muted: hexColor, accent: hexColor, border: hexColor,
  }).strict(),
  typography: z.object({
    bodyFont: z.enum(['system-sans', 'system-serif', 'system-mono']),
    headingFont: z.enum(['system-sans', 'system-serif', 'system-mono']),
    scale: z.enum(['compact', 'comfortable', 'large']),
  }).strict(),
  layout: z.object({
    contentWidth: z.enum(['narrow', 'medium', 'wide']),
    density: z.enum(['compact', 'comfortable']),
    radius: z.enum(['none', 'soft', 'round']),
  }).strict(),
}).strict();

const intro = z.object({
  type: z.literal('intro'), variant: z.enum(['minimal', 'centered', 'split']),
  showAuthor: z.boolean(), presentation: presentationSpecSchema.optional(),
}).strict();
const posts = z.object({
  type: z.literal('posts'),
  source: z.discriminatedUnion('strategy', [
    z.object({ strategy: z.literal('latest') }).strict(),
    z.object({ strategy: z.literal('recently-updated') }).strict(),
  ]),
  variant: z.enum(['hero', 'split', 'list', 'cards', 'grid']),
  limit: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(6), z.literal(9)]),
  columns: oneToThree.optional(),
  exclude: z.object({ sections: z.array(nodeId).min(1).max(7) }).strict().optional(),
  presentation: presentationSpecSchema.optional(),
}).strict();
const topics = z.object({
  type: z.literal('topics'), variant: z.enum(['list', 'cloud']),
  limit: z.union([z.literal(6), z.literal(12), z.literal(24)]),
  presentation: presentationSpecSchema.optional(),
}).strict();
const author = z.object({
  type: z.literal('author'), variant: z.enum(['compact', 'profile']),
  presentation: presentationSpecSchema.optional(),
}).strict();
const homeSection = z.discriminatedUnion('type', [intro, posts, topics, author]);
const sections = z.record(homeSection).superRefine((value, context) => {
  const ids = Object.keys(value);
  if (ids.length < 1 || ids.length > 8) context.addIssue({ code: 'custom', message: 'Homepage needs 1–8 sections' });
  for (const id of ids) {
    const result = nodeId.safeParse(id);
    if (!result.success) context.addIssue({ code: 'custom', path: [id], message: 'Invalid design node ID' });
  }
});

const stack = z.object({
  layout: z.literal('stack'), sections,
  regions: z.object({ main: z.array(nodeId) }).strict(),
  presentation: presentationSpecSchema.optional(),
}).strict();
const sidebar = z.object({
  layout: z.literal('sidebar'), sections,
  regions: z.object({ main: z.array(nodeId), aside: z.array(nodeId) }).strict(),
  presentation: presentationSpecSchema.optional(),
}).strict();
const magazine = z.object({
  layout: z.literal('magazine'), sections,
  regions: z.object({ lead: z.array(nodeId), main: z.array(nodeId), rail: z.array(nodeId) }).strict(),
  presentation: presentationSpecSchema.optional(),
}).strict();
const home = z.discriminatedUnion('layout', [stack, sidebar, magazine]).superRefine((value, context) => {
  const ids = Object.keys(value.sections);
  const used = Object.values(value.regions).flat();
  if (new Set(used).size !== used.length || used.length !== ids.length || used.some((id) => !Object.hasOwn(value.sections, id))) {
    context.addIssue({ code: 'custom', path: ['regions'], message: 'Each homepage section must appear exactly once in a region' });
  }
  if (!Object.values(value.sections).some((section) => section.type === 'posts')) {
    context.addIssue({ code: 'custom', path: ['sections'], message: 'Homepage needs a posts section' });
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      context.addIssue({ code: 'custom', path: ['sections', id, 'exclude'], message: 'Post section exclusions must be acyclic' });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const section = value.sections[id];
    if (section?.type === 'posts') {
      for (const excludedId of section.exclude?.sections ?? []) {
        if (value.sections[excludedId]?.type !== 'posts') {
          context.addIssue({ code: 'custom', path: ['sections', id, 'exclude'], message: 'Exclusions must reference posts sections' });
        } else visit(excludedId);
      }
      if (section.exclude && new Set(section.exclude.sections).size !== section.exclude.sections.length) {
        context.addIssue({ code: 'custom', path: ['sections', id, 'exclude'], message: 'Duplicate post exclusion' });
      }
      if (section.variant === 'list' && section.columns !== undefined && section.columns !== 1) {
        context.addIssue({ code: 'custom', path: ['sections', id, 'columns'], message: 'List columns must be absent or 1' });
      }
      if (section.variant === 'grid' && section.columns !== 2 && section.columns !== 3) {
        context.addIssue({ code: 'custom', path: ['sections', id, 'columns'], message: 'Grid columns must be 2 or 3' });
      }
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
});
export const homePageSpecV2Schema = home;

const index = z.object({
  layout: z.enum(['list', 'grid', 'magazine']),
  item: z.object({
    variant: z.enum(['divided', 'cards', 'numbered']),
    showDescription: z.boolean(), showTags: z.boolean(),
    presentation: presentationSpecSchema.optional(),
  }).strict(),
  columns: oneToThree.optional(),
  presentation: presentationSpecSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.layout === 'list' && value.columns !== undefined && value.columns !== 1) {
    context.addIssue({ code: 'custom', path: ['columns'], message: 'List columns must be absent or 1' });
  }
  if (value.layout === 'grid' && value.columns !== 2 && value.columns !== 3) {
    context.addIssue({ code: 'custom', path: ['columns'], message: 'Grid columns must be 2 or 3' });
  }
});

const modulePresentation = { presentation: presentationSpecSchema.optional() };
const articleModule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('metadata'), variant: z.enum(['compact', 'detailed']), ...modulePresentation }).strict(),
  z.object({ type: z.literal('toc'), variant: z.enum(['inline', 'aside']), ...modulePresentation }).strict(),
  z.object({ type: z.literal('tags'), variant: z.literal('list'), ...modulePresentation }).strict(),
  z.object({ type: z.literal('author'), variant: z.enum(['compact', 'profile']), ...modulePresentation }).strict(),
  z.object({ type: z.literal('related-posts'), variant: z.enum(['list', 'cards']), limit: z.union([z.literal(2), z.literal(3), z.literal(5)]), ...modulePresentation }).strict(),
  z.object({ type: z.literal('navigation'), variant: z.enum(['links', 'cards']), ...modulePresentation }).strict(),
]);
const article = z.object({
  layout: z.enum(['reading', 'wide', 'with-aside']),
  header: z.object({ variant: z.enum(['simple', 'editorial']), presentation: presentationSpecSchema.optional() }).strict(),
  modules: z.record(articleModule),
  regions: z.object({ beforeBody: z.array(nodeId), aside: z.array(nodeId), afterBody: z.array(nodeId) }).strict(),
  prose: z.object({ codeBlock: z.enum(['plain', 'panel']), presentation: presentationSpecSchema.optional() }).strict(),
  presentation: presentationSpecSchema.optional(),
}).strict().superRefine((value, context) => {
  const ids = Object.keys(value.modules);
  for (const id of ids) {
    if (!nodeId.safeParse(id).success) context.addIssue({ code: 'custom', path: ['modules', id], message: 'Invalid design node ID' });
  }
  const used = Object.values(value.regions).flat();
  if (new Set(used).size !== used.length || used.length !== ids.length || used.some((id) => !Object.hasOwn(value.modules, id))) {
    context.addIssue({ code: 'custom', path: ['regions'], message: 'Each article module must appear exactly once in a region' });
  }
  if (value.layout !== 'with-aside' && value.regions.aside.length > 0) {
    context.addIssue({ code: 'custom', path: ['regions', 'aside'], message: 'Aside modules require with-aside layout' });
  }
  for (const id of value.regions.aside) {
    if (value.modules[id]?.type !== 'toc' && value.modules[id]?.type !== 'related-posts') {
      context.addIssue({ code: 'custom', path: ['regions', 'aside'], message: 'Only TOC and related posts may appear in the aside' });
    }
  }
  for (const [id, module] of Object.entries(value.modules)) {
    const placement = value.regions.beforeBody.includes(id) ? 'beforeBody' : value.regions.aside.includes(id) ? 'aside' : 'afterBody';
    const allowed: Record<typeof module.type, readonly string[]> = {
      metadata: ['beforeBody'],
      toc: ['beforeBody', 'aside'],
      tags: ['beforeBody', 'afterBody'],
      author: ['afterBody'],
      'related-posts': ['aside', 'afterBody'],
      navigation: ['afterBody'],
    };
    if (!allowed[module.type].includes(placement)) {
      context.addIssue({ code: 'custom', path: ['modules', id], message: `Invalid placement for ${module.type} module` });
    }
    if (module.type === 'toc' && module.variant === 'aside' && !value.regions.aside.includes(id)) {
      context.addIssue({ code: 'custom', path: ['modules', id], message: 'Aside TOC must be placed in the aside region' });
    }
    if (module.type === 'toc' && module.variant === 'inline' && value.regions.aside.includes(id)) {
      context.addIssue({ code: 'custom', path: ['modules', id], message: 'Inline TOC cannot be placed in the aside region' });
    }
  }
});

export const blogDesignSpecV2Schema = z.object({
  version: z.literal(2),
  theme,
  chrome: z.object({
    header: z.object({ variant: z.enum(['compact', 'centered', 'masthead']), presentation: presentationSpecSchema.optional() }).strict(),
    footer: z.object({ variant: z.enum(['minimal', 'profile']), presentation: presentationSpecSchema.optional() }).strict(),
  }).strict(),
  pages: z.object({ home, index, article }).strict(),
  description: z.string().trim().min(1).max(240),
}).strict().superRefine((value, context) => {
  if (contrastRatio(value.theme.colors.text, value.theme.colors.background) < 4.5) {
    context.addIssue({ code: 'custom', path: ['theme', 'colors', 'text'], message: 'Text contrast is too low' });
  }
  if (contrastRatio(value.theme.colors.accent, value.theme.colors.background) < 4.5) {
    context.addIssue({ code: 'custom', path: ['theme', 'colors', 'accent'], message: 'Link contrast is too low' });
  }
});

export type BlogDesignSpecV2 = z.infer<typeof blogDesignSpecV2Schema>;
export type PresentationSpec = z.infer<typeof presentationSpecSchema>;
export type DesignNodeId = string;

export function validateBlogDesignSpecV2(input: unknown): BlogDesignSpecV2 {
  return structuredClone(blogDesignSpecV2Schema.parse(input));
}
