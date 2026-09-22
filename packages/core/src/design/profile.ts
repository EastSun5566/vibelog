import type { Post } from '../types.js';
import type { ContentProfile } from './types.js';

function usage(count: number, total: number): ContentProfile['codeUsage'] {
  if (count === 0) return 'none';
  return count >= Math.max(2, Math.ceil(total / 2)) ? 'frequent' : 'some';
}

export function createContentProfile(posts: Post[]): ContentProfile {
  const postCount = posts.length;
  const average = postCount === 0 ? 0 : posts.reduce((sum, post) => sum + post.content.trim().length, 0) / postCount;
  const count = (pattern: RegExp) => posts.filter((post) => pattern.test(post.content)).length;
  return {
    postCount,
    tagCount: new Set(posts.flatMap((post) => post.tags ?? []).map((tag) => tag.normalize('NFKC').trim().toLocaleLowerCase('und')).filter(Boolean)).size,
    // Source-character thresholds are deterministic and intentionally cheap; upgrade only if editorial data shows poor classification.
    averageLength: average < 1_000 ? 'short' : average < 3_000 ? 'medium' : 'long',
    codeUsage: usage(count(/```|~~~|`[^`\n]+`/u), postCount),
    imageUsage: usage(count(/!\[[^\]]*\]\([^)]*\)|<img\b/iu), postCount),
    mathUsage: usage(count(/\$\$[^$]+\$\$|\\\(|\\\[|(?:^|\s)\$[^$\n]+\$/mu), postCount),
  };
}
