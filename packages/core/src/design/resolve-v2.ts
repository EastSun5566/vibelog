import { homePageSpecV2Schema, type BlogDesignSpecV2, type DesignNodeId } from './schema-v2.js';

export interface ResolvablePost {
  slug: string;
  publishedAt: string;
  updatedAt?: string;
}

export interface ResolvedHomeSection<T extends ResolvablePost> {
  id: DesignNodeId;
  config: BlogDesignSpecV2['pages']['home']['sections'][string];
  posts?: T[];
}

export interface ResolvedHomeComposition<T extends ResolvablePost> {
  layout: BlogDesignSpecV2['pages']['home']['layout'];
  regions: Record<string, ResolvedHomeSection<T>[]>;
}

export function resolveHomeComposition<T extends ResolvablePost>(
  design: BlogDesignSpecV2['pages']['home'],
  posts: readonly T[],
): ResolvedHomeComposition<T> {
  const home = homePageSpecV2Schema.parse(design);
  const uniqueSlugs = new Set<string>();
  for (const post of posts) {
    if (!post.slug || uniqueSlugs.has(post.slug) || Number.isNaN(Date.parse(post.publishedAt)) || (post.updatedAt && Number.isNaN(Date.parse(post.updatedAt)))) {
      throw new Error('Invalid or duplicate post in content snapshot');
    }
    uniqueSlugs.add(post.slug);
  }
  const selected = new Map<string, T[]>();
  const select = (id: string): T[] => {
    const existing = selected.get(id);
    if (existing) return existing;
    const section = home.sections[id];
    if (section?.type !== 'posts') return [];
    const excluded = new Set((section.exclude?.sections ?? []).flatMap((reference) => select(reference).map((post) => post.slug)));
    const sorted = [...posts].sort((left, right) => {
      const leftKey = section.source.strategy === 'recently-updated' ? left.updatedAt ?? left.publishedAt : left.publishedAt;
      const rightKey = section.source.strategy === 'recently-updated' ? right.updatedAt ?? right.publishedAt : right.publishedAt;
      return Date.parse(rightKey) - Date.parse(leftKey) || left.slug.localeCompare(right.slug);
    });
    const result = sorted.filter((post) => !excluded.has(post.slug)).slice(0, section.limit);
    selected.set(id, result);
    return result;
  };
  return {
    layout: home.layout,
    regions: Object.fromEntries(Object.entries(home.regions).map(([region, ids]) => [
      region,
      ids.map((id) => {
        const config = home.sections[id];
        if (!config) throw new Error('Missing validated home section');
        return config.type === 'posts' ? { id, config, posts: select(id) } : { id, config };
      }),
    ])),
  };
}
