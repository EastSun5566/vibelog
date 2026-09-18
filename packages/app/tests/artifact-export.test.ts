import { describe, expect, it, vi } from 'vitest';
import { ArtifactExportError, createArtifactZip } from '../src/artifact-export.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';

function stream(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function artifactStore(objects: Record<string, string>): { store: ArtifactStore; readObject: ReturnType<typeof vi.fn> } {
  const readObject = vi.fn((_id: string, path: string) => Promise.resolve(path in objects ? { body: stream(objects[path] ?? '') } : null));
  return { store: {
    uploadDirectory: vi.fn(),
    copyArtifact: vi.fn(),
    listObjects: vi.fn(() => Promise.resolve(Object.keys(objects))),
    readObject,
    deleteArtifact: vi.fn(),
  }, readObject };
}

describe('artifact ZIP export', () => {
  it('streams every published file at the archive root', async () => {
    const { store, readObject } = artifactStore({ 'index.html': '<h1>VibeLog</h1>', 'assets/theme.css': 'body{}', 'blog/post/index.html': '<article>Post</article>' });
    const bytes = new Uint8Array(await new Response(await createArtifactZip(store, 'release-id')).arrayBuffer());
    const text = new TextDecoder().decode(bytes);

    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(text).toContain('index.html');
    expect(text).toContain('assets/theme.css');
    expect(text).toContain('blog/post/index.html');
    expect(readObject).toHaveBeenCalledTimes(3);
  });

  it('rejects empty and unsafe artifacts before starting a download', async () => {
    await expect(createArtifactZip(artifactStore({}).store, 'empty')).rejects.toThrow(new ArtifactExportError('Published artifact is empty'));
    const unsafe = artifactStore({ '../secret.txt': 'nope' });
    await expect(createArtifactZip(unsafe.store, 'unsafe')).rejects.toThrow(new ArtifactExportError('Artifact contains an unsafe path'));
    expect(unsafe.readObject).not.toHaveBeenCalled();
  });
});
