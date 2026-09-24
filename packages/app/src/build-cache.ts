import type { ArtifactStore } from './ports/artifact-store.js';

/** Cache is advisory: only a complete, ready artifact with an exact key may be reused. */
export async function findReusableBuild(store: ArtifactStore, candidates: readonly string[], identity: string): Promise<string | undefined> {
  for (const id of candidates) {
    const marker = await store.readObject(id, 'build-identity.json');
    if (!marker) continue;
    try {
      const value = await new Response(marker.body).json() as { identity?: unknown };
      if (value.identity === identity) return id;
    } catch { /* A damaged cache entry is a miss. */ }
  }
  return undefined;
}
