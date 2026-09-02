import { AppError } from './http.js';
import type { ArtifactStore, StoredObject } from './ports/artifact-store.js';

export interface ResolvedArtifactObject {
  path: string;
  object: StoredObject;
}

function unsafePath(): never {
  throw new AppError('unsafe_path', 'Unsafe path', 400);
}

export function safeArtifactPath(requestPath: string): string {
  if (/%(?:2f|5c|2e)/i.test(requestPath)) unsafePath();
  try {
    const relativePath = requestPath.replace(/^\/+/, '').replace(/\/$/, '') || 'index.html';
    const path = decodeURIComponent(relativePath).replaceAll('\\', '/');
    if (path.split('/').some((part) => !part || part === '.' || part === '..')) unsafePath();
    return path;
  } catch (error) {
    if (error instanceof AppError) throw error;
    unsafePath();
  }
}

export async function findArtifactObject(store: ArtifactStore, artifactId: string, requestPath: string): Promise<ResolvedArtifactObject | null> {
  const path = safeArtifactPath(requestPath);
  const direct = await store.readObject(artifactId, path);
  if (direct) return { path, object: direct };
  const indexPath = `${path}/index.html`;
  const index = await store.readObject(artifactId, indexPath);
  return index ? { path: indexPath, object: index } : null;
}
