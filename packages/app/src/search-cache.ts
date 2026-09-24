import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ArtifactStore } from './ports/artifact-store.js';

/** Returns a local cache only when the previous draft has the exact search identity. */
export async function materializeSearchCache(store: ArtifactStore, draftArtifactId: string, expectedIdentity: string, directory: string): Promise<{ directory: string; identity: string } | undefined> {
  const marker = await store.readObject(draftArtifactId, 'search-index.json');
  if (!marker) return undefined;
  let identity: unknown;
  try { identity = (await new Response(marker.body).json() as { identity?: unknown }).identity; }
  catch { return undefined; }
  if (identity !== expectedIdentity) return undefined;
  const paths = (await store.listObjects(draftArtifactId)).filter((path) => path.startsWith('pagefind/'));
  if (!paths.includes('pagefind/pagefind.js')) return undefined;
  for (const path of paths) {
    if (path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Unsafe search cache path');
    const object = await store.readObject(draftArtifactId, path);
    if (!object) return undefined;
    const destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(await new Response(object.body).arrayBuffer()));
  }
  await writeFile(join(directory, 'search-index.json'), JSON.stringify({ identity: expectedIdentity }));
  return { directory, identity: expectedIdentity };
}
