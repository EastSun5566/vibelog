import type { Post } from '../types.js';
import type { ContentProfile, PostSample } from './types.js';

function usage(count: number, total: number): ContentProfile['codeUsage'] {
  if (count === 0) return 'none';
  return count >= Math.max(2, Math.ceil(total / 2)) ? 'frequent' : 'some';
}

export function createContentProfile(posts: Post[]): ContentProfile {
  const postCount = posts.length;
  const average =
    postCount === 0
      ? 0
      : posts.reduce((sum, post) => sum + post.content.trim().length, 0) / postCount;
  const count = (pattern: RegExp) => posts.filter((post) => pattern.test(post.content)).length;
  return {
    postCount,
    tagCount: new Set(
      posts
        .flatMap((post) => post.tags ?? [])
        .map((tag) => tag.normalize('NFKC').trim().toLocaleLowerCase('und'))
        .filter(Boolean),
    ).size,
    // Source-character thresholds are deterministic and intentionally cheap; upgrade only if editorial data shows poor classification.
    averageLength: average < 1_000 ? 'short' : average < 3_000 ? 'medium' : 'long',
    codeUsage: usage(count(/```|~~~|`[^`\n]+`/u), postCount),
    imageUsage: usage(count(/!\[[^\]]*\]\([^)]*\)|<img\b/iu), postCount),
    mathUsage: usage(count(/\$\$[^$]+\$\$|\\\(|\\\[|(?:^|\s)\$[^$\n]+\$/mu), postCount),
  };
}

/** Markdown reduced to readable prose: no code, images, links, HTML or formatting marks. */
function plainText(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n/u, '')
    .replace(/(```|~~~)[\s\S]*?\1/gu, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\$\$[\s\S]*?\$\$/gu, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gmu, '')
    .replace(/[*_`~|]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Up to `limit` of the newest posts, each with its tags and a short excerpt. */
export function createPostSamples(posts: Post[], limit = 12, excerptLength = 300): PostSample[] {
  return [...posts]
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))
    .slice(0, limit)
    .map((post) => ({
      title: post.title.slice(0, 160),
      tags: (post.tags ?? []).slice(0, 8).map((tag) => tag.slice(0, 40)),
      excerpt: Array.from(plainText(post.content)).slice(0, excerptLength).join(''),
    }));
}
