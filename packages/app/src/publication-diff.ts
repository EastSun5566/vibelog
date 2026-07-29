import type {
  BlogRecord,
  PublishedReleaseRecord,
  ReleaseSnapshot,
  SyncedPostSummary,
  ThemeRevisionRecord,
} from './database.js';

export type PublicationDiffMode = 'first' | 'tracked' | 'legacy';
export type IdentityChange = 'title' | 'description' | 'author' | 'language';

export interface PublicationDiff {
  mode: PublicationDiffMode;
  added: SyncedPostSummary[];
  updated: SyncedPostSummary[];
  removed: SyncedPostSummary[];
  identityChanges: IdentityChange[];
  themeChanged: boolean;
  rebuilt: boolean;
  includedCount: number;
}

export function createReleaseSnapshot(blog: BlogRecord): ReleaseSnapshot {
  return {
    site: {
      title: blog.title ?? blog.username,
      description: blog.description ?? '',
      author: blog.author ?? blog.username,
      language: blog.language,
    },
    posts: blog.contentManifest ?? [],
  };
}

function includedPosts(posts: SyncedPostSummary[]): Map<string, SyncedPostSummary> {
  return new Map(posts.filter((post) => post.included).map((post) => [post.slug, post]));
}

function normalizedTags(post: SyncedPostSummary): string[] {
  return (post.tags ?? [])
    .map((tag) => `${tag.name.normalize('NFKC').toLocaleLowerCase('und')}\0${tag.slug}`)
    .sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function postChanged(draft: SyncedPostSummary, live: SyncedPostSummary): boolean {
  const contentChanged = Boolean(draft.contentHash && live.contentHash && draft.contentHash !== live.contentHash);
  return draft.title !== live.title
    || draft.publishedAt !== live.publishedAt
    || (draft.updatedAt ?? null) !== (live.updatedAt ?? null)
    || !arraysEqual(normalizedTags(draft), normalizedTags(live))
    || contentChanged;
}

export function calculatePublicationDiff(
  blog: BlogRecord,
  activeTheme: ThemeRevisionRecord,
  liveRelease: PublishedReleaseRecord | null,
): PublicationDiff {
  const draftSnapshot = createReleaseSnapshot(blog);
  const draftPosts = includedPosts(draftSnapshot.posts);
  const empty = {
    added: [] as SyncedPostSummary[],
    updated: [] as SyncedPostSummary[],
    removed: [] as SyncedPostSummary[],
    identityChanges: [] as IdentityChange[],
    includedCount: draftPosts.size,
  };

  if (!liveRelease) {
    return { mode: 'first', ...empty, themeChanged: false, rebuilt: false };
  }
  if (!liveRelease.snapshot) {
    return {
      mode: 'legacy',
      ...empty,
      themeChanged: activeTheme.id !== liveRelease.themeRevisionId,
      rebuilt: blog.contentVersion !== liveRelease.contentVersion,
    };
  }

  const livePosts = includedPosts(liveRelease.snapshot.posts);
  const added = [...draftPosts.values()].filter((post) => !livePosts.has(post.slug));
  const removed = [...livePosts.values()].filter((post) => !draftPosts.has(post.slug));
  const updated = [...draftPosts.values()].filter((post) => {
    const livePost = livePosts.get(post.slug);
    return livePost ? postChanged(post, livePost) : false;
  });
  const identityChanges: IdentityChange[] = [];
  if (draftSnapshot.site.title !== liveRelease.snapshot.site.title) identityChanges.push('title');
  if (draftSnapshot.site.description !== liveRelease.snapshot.site.description) identityChanges.push('description');
  if (draftSnapshot.site.author !== liveRelease.snapshot.site.author) identityChanges.push('author');
  if (draftSnapshot.site.language !== liveRelease.snapshot.site.language) identityChanges.push('language');
  const hasSemanticContentChange = added.length > 0 || updated.length > 0 || removed.length > 0 || identityChanges.length > 0;

  return {
    mode: 'tracked',
    added,
    updated,
    removed,
    identityChanges,
    themeChanged: activeTheme.id !== liveRelease.themeRevisionId,
    rebuilt: blog.contentVersion !== liveRelease.contentVersion && !hasSemanticContentChange,
    includedCount: draftPosts.size,
  };
}
