import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { materializeSearchCache } from '../src/search-cache.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
function object(value: string) { return { body: new Response(value).body as ReadableStream<Uint8Array> }; }

describe('search index cache', () => {
  it('copies only Pagefind files when the versioned content identity matches', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vibelog-search-cache-')); directories.push(directory);
    const readObject = vi.fn((_id: string, path: string) => Promise.resolve(path === 'search-index.json' ? object('{"identity":"same"}') : path === 'pagefind/pagefind.js' ? object('search code') : null));
    const store = {
      readObject,
      listObjects: vi.fn(() => Promise.resolve(['index.html', 'pagefind/pagefind.js'])),
    } as unknown as ArtifactStore;
    expect(await materializeSearchCache(store, 'draft', 'same', directory)).toEqual({ directory, identity: 'same' });
    expect(await readFile(join(directory, 'pagefind/pagefind.js'), 'utf8')).toBe('search code');
    expect(readObject).not.toHaveBeenCalledWith('draft', 'index.html');
  });
  it('bypasses an index from a different source or schema', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vibelog-search-cache-')); directories.push(directory);
    const listObjects = vi.fn();
    const store = { readObject: vi.fn(() => Promise.resolve(object('{"identity":"old"}'))), listObjects } as unknown as ArtifactStore;
    expect(await materializeSearchCache(store, 'draft', 'new', directory)).toBeUndefined();
    expect(listObjects).not.toHaveBeenCalled();
  });
});
