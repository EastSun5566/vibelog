import { lstat, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BlogStorageReference } from './database.js';
import { blogRoot } from './security/path.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_DIRECTORY = new RegExp(`^${UUID}$`, 'iu');
const SYNC_DIRECTORY = new RegExp(`^\\.sync-${UUID}$`, 'iu');
const RELEASE_STAGING_DIRECTORY = new RegExp(`^\\.staging-${UUID}$`, 'iu');

export interface StorageReconciliationResult { removed: number; warnings: number }

function pathIsWithin(base: string, target: string): boolean {
  const pathFromBase = relative(resolve(base), resolve(target));
  return pathFromBase !== '..' && !pathFromBase.startsWith(`..${sep}`) && !isAbsolute(pathFromBase);
}

function managedDraft(root: string, artifact: string): boolean {
  const resolved = resolve(artifact);
  if (resolved === resolve(root, 'draft')) return true;
  return pathIsWithin(resolve(root, 'drafts'), resolved) && UUID_DIRECTORY.test(relative(resolve(root, 'drafts'), resolved));
}

function managedRelease(root: string, artifact: string): boolean {
  const resolved = resolve(artifact);
  return pathIsWithin(resolve(root, 'releases'), resolved) && UUID_DIRECTORY.test(relative(resolve(root, 'releases'), resolved));
}

async function removeEntry(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) await unlink(path);
  else await rm(path, { recursive: true, force: true });
}

async function entries(path: string): Promise<string[]> {
  try { return await readdir(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function isSafeDirectory(base: string, path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
    const [realBase, realPath] = await Promise.all([realpath(base), realpath(path)]);
    return pathIsWithin(realBase, realPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function reconcileStorage(dataRoot: string, references: BlogStorageReference[]): Promise<StorageReconciliationResult> {
  const blogsRoot = resolve(dataRoot, 'blogs');
  let removed = 0; let warnings = 0;

  for (const reference of references) {
    let root: string;
    try { root = blogRoot(dataRoot, reference.userId, reference.blogId); }
    catch { warnings += 1; continue; }

    try {
      if (!await isSafeDirectory(blogsRoot, root)) {
        if (await lstat(root).catch(() => null)) warnings += 1;
        continue;
      }
    } catch { warnings += 1; continue; }

    const keptDrafts = new Set<string>();
    if (reference.draftArtifact) {
      if (managedDraft(root, reference.draftArtifact)) keptDrafts.add(resolve(reference.draftArtifact));
      else warnings += 1;
    }
    const keptReleases = new Set<string>();
    for (const artifact of reference.releaseArtifacts) {
      if (managedRelease(root, artifact)) keptReleases.add(resolve(artifact));
      else warnings += 1;
    }

    for (const artifact of [...keptDrafts, ...keptReleases]) {
      if (!await lstat(artifact).catch(() => null)) warnings += 1;
    }

    const candidates: string[] = [];
    try {
      for (const name of await entries(root)) if (SYNC_DIRECTORY.test(name)) candidates.push(join(root, name));
      const legacyDraft = join(root, 'draft');
      if (!keptDrafts.has(resolve(legacyDraft)) && await lstat(legacyDraft).catch(() => null)) candidates.push(legacyDraft);

      const draftsRoot = join(root, 'drafts');
      if (await isSafeDirectory(root, draftsRoot)) {
        for (const name of await entries(draftsRoot)) {
          const artifact = join(draftsRoot, name);
          if (UUID_DIRECTORY.test(name) && !keptDrafts.has(resolve(artifact))) candidates.push(artifact);
        }
      } else if (await lstat(draftsRoot).catch(() => null)) warnings += 1;

      const releasesRoot = join(root, 'releases');
      if (await isSafeDirectory(root, releasesRoot)) {
        for (const name of await entries(releasesRoot)) {
          const artifact = join(releasesRoot, name);
          if (RELEASE_STAGING_DIRECTORY.test(name) || UUID_DIRECTORY.test(name) && !keptReleases.has(resolve(artifact))) candidates.push(artifact);
        }
      } else if (await lstat(releasesRoot).catch(() => null)) warnings += 1;
    } catch { warnings += 1; continue; }

    for (const candidate of candidates) {
      try { await removeEntry(candidate); removed += 1; }
      catch { warnings += 1; }
    }
  }

  return { removed, warnings };
}
