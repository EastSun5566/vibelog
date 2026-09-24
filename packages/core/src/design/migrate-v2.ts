import type { BlogDesignSpecV1, StyleRule } from './types.js';
import { normalizeDesignDecoration } from './normalize.js';
import { parsePersistedDesign } from './migrate.js';
import { validateBlogDesignSpec } from './validate.js';
import { validateBlogDesignSpecV2, type BlogDesignSpecV2, type PresentationSpec } from './schema-v2.js';

// One-time data conversion. This module must not be called by the normal runtime path.
const sectionIds = {
  intro: 'intro',
  'featured-posts': 'featured',
  'recent-posts': 'recent',
  topics: 'topics',
  author: 'author',
} as const;

function toPresentation(rule: StyleRule | undefined): PresentationSpec | undefined {
  if (!rule) return undefined;
  const value = rule.declarations;
  const presentation: PresentationSpec = {};
  if (value.textAlign) presentation.align = value.textAlign;
  if (value.width) presentation.width = value.width;
  if (value.surface) presentation.surface = value.surface === 'transparent' ? 'plain' : value.surface === 'surface' ? 'soft' : 'prominent';
  if (value.border) presentation.frame = value.border === 'hairline' ? 'subtle' : value.border === 'strong' ? 'strong' : 'none';
  if (value.paddingBlock || value.gap) {
    const size = value.paddingBlock ?? value.gap;
    presentation.spacing = size === 'sm' ? 'tight' : size === 'lg' ? 'relaxed' : size === 'xl' ? 'spacious' : size === 'none' ? 'none' : 'normal';
  }
  return Object.keys(presentation).length > 0 ? presentation : undefined;
}

export function migrateDesignV1ToV2(input: BlogDesignSpecV1): BlogDesignSpecV2 {
  const v1 = normalizeDesignDecoration(validateBlogDesignSpec(input));
  const style = (target: StyleRule['target']): PresentationSpec | undefined => toPresentation(v1.styles.rules.find((rule) => rule.target === target));
  const sections: Record<string, BlogDesignSpecV2['pages']['home']['sections'][string]> = {};
  const order: string[] = [];
  for (const section of v1.pages.home.sections) {
    const id = sectionIds[section.type];
    order.push(id);
    switch (section.type) {
      case 'intro':
        sections[id] = { ...section, presentation: style('home.intro') };
        break;
      case 'featured-posts':
        sections[id] = {
          type: 'posts', source: { strategy: 'latest' }, variant: section.variant,
          limit: section.count, presentation: style('posts.items'),
        };
        break;
      case 'recent-posts':
        sections[id] = {
          type: 'posts', source: { strategy: 'latest' }, variant: section.variant,
          limit: section.limit, columns: section.columns,
          ...(v1.pages.home.sections.some((candidate) => candidate.type === 'featured-posts') ? { exclude: { sections: ['featured'] } } : {}),
          presentation: style('posts.items'),
        };
        break;
      case 'topics':
      case 'author':
        sections[id] = section;
        break;
    }
  }

  const modules: BlogDesignSpecV2['pages']['article']['modules'] = {
    metadata: { type: 'metadata', variant: v1.pages.article.metadata },
    tags: { type: 'tags', variant: 'list' },
    navigation: { type: 'navigation', variant: v1.pages.article.navigation },
  };
  const beforeBody = ['metadata', 'tags'];
  const aside: string[] = [];
  if (v1.pages.article.toc !== 'hidden') {
    const inAside = v1.pages.article.toc === 'auto-aside';
    modules.toc = { type: 'toc', variant: inAside ? 'aside' : 'inline', presentation: style('article.toc') };
    (inAside ? aside : beforeBody).push('toc');
  }

  return validateBlogDesignSpecV2({
    version: 2,
    theme: v1.theme,
    chrome: {
      header: { ...v1.chrome.header, presentation: style('site.header') },
      footer: { ...v1.chrome.footer, presentation: style('site.footer') },
    },
    pages: {
      home: { layout: 'stack', sections, regions: { main: order }, presentation: style('home.sections') },
      index: {
        layout: v1.pages.index.layout,
        columns: v1.pages.index.columns,
        item: {
          variant: v1.pages.index.itemVariant,
          showDescription: v1.pages.index.showDescription,
          showTags: v1.pages.index.showTags,
          presentation: style('posts.items'),
        },
      },
      article: {
        layout: v1.pages.article.layout,
        header: { variant: v1.pages.article.header, presentation: style('article.header') },
        modules,
        regions: { beforeBody, aside, afterBody: ['navigation'] },
        prose: { codeBlock: v1.pages.article.codeBlock, presentation: style('article.prose') },
      },
    },
    description: v1.description,
  });
}

export function migratePersistedDesignToV2(input: unknown): BlogDesignSpecV2 {
  if (input && typeof input === 'object' && !Array.isArray(input) && (input as { version?: unknown }).version === 2) {
    return validateBlogDesignSpecV2(input);
  }
  return migrateDesignV1ToV2(parsePersistedDesign(input));
}
