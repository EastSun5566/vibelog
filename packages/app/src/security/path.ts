import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string, name = 'id'): string {
  if (!SAFE_ID.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

export function resolveWithin(base: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (!segment || isAbsolute(segment) || segment === '.' || segment === '..' || segment.includes('\0') || /[\\/]/.test(segment)) {
      throw new Error('Unsafe path segment');
    }
  }

  const root = resolve(base);
  const target = resolve(root, ...segments);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
    throw new Error('Path escapes data root');
  }
  return target;
}

export function resolveRelativeWithin(base: string, requestPath: string): string {
  if (requestPath.includes('\0') || isAbsolute(requestPath) || /%(?:2f|5c|2e)/i.test(requestPath)) {
    throw new Error('Unsafe request path');
  }
  const root = resolve(base);
  const target = resolve(root, requestPath.replace(/^[/\\]+/, ''));
  const pathFromRoot = relative(root, target);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
    throw new Error('Path escapes preview root');
  }
  return target;
}

export async function assertNoSymlinkEscape(base: string, target: string): Promise<void> {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  const pathFromBase = relative(resolvedBase, resolvedTarget);
  if (pathFromBase.startsWith(`..${sep}`) || pathFromBase === '..' || isAbsolute(pathFromBase)) {
    throw new Error('Resolved path escapes preview root');
  }

  let current = resolvedBase;
  for (const segment of pathFromBase.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('Symbolic links are not served');
    }
  }

  const realBase = await realpath(resolvedBase);
  const realTarget = await realpath(target);
  const pathFromRoot = relative(realBase, realTarget);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
    throw new Error('Resolved path escapes preview root');
  }
}

export function projectRoot(dataRoot: string, userId: string, projectId: string): string {
  return resolveWithin(resolve(dataRoot, 'projects'), assertUuid(userId, 'user id'), assertUuid(projectId, 'project id'));
}
