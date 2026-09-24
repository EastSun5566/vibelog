import { describe, expect, it, vi } from 'vitest';
import { findReusableBuild } from '../src/build-cache.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';

function object(value: string) {
  return { body: new Response(value).body as ReadableStream<Uint8Array> };
}

describe('exact structural build cache', () => {
  it('ignores missing, malformed, and stale markers before reusing an exact match', async () => {
    const readObject = vi.fn((id: string) => Promise.resolve(
      id === 'damaged' ? object('not json')
        : id === 'stale' ? object('{"identity":"previous"}')
          : id === 'exact' ? object('{"identity":"current"}') : null,
    ));
    const store = { readObject } as unknown as ArtifactStore;
    expect(await findReusableBuild(store, ['missing', 'damaged', 'stale', 'exact'], 'current')).toBe('exact');
    expect(readObject).toHaveBeenCalledTimes(4);
    expect(readObject).toHaveBeenCalledWith('exact', 'build-identity.json');
  });

  it('does not reuse an artifact for a different design identity', async () => {
    const store = { readObject: vi.fn(() => Promise.resolve(object('{"identity":"old"}'))) } as unknown as ArtifactStore;
    expect(await findReusableBuild(store, ['draft'], 'new')).toBeUndefined();
  });
});
