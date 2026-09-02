import { describe, expect, it, vi } from 'vitest';
import { findArtifactObject, safeArtifactPath } from '../src/artifact-serving.js';
import { AppError } from '../src/http.js';
import type { ArtifactStore } from '../src/ports/artifact-store.js';

function body(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function storeWith(objects: Record<string, string>): { store: ArtifactStore; readObject: ReturnType<typeof vi.fn> } {
  const readObject = vi.fn((_artifactId: string, path: string) => Promise.resolve(objects[path] ? { body: body(objects[path]) } : null));
  return { store: {
    uploadDirectory: vi.fn(),
    copyArtifact: vi.fn(),
    readObject,
    deleteArtifact: vi.fn(),
  }, readObject };
}

describe('artifact serving paths', () => {
  it.each([
    ['/', 'index.html'],
    ['/blog/web-interface-guidelines', 'blog/web-interface-guidelines'],
    ['/blog/web-interface-guidelines/', 'blog/web-interface-guidelines'],
    ['/theme.css', 'theme.css'],
  ])('normalizes %s to %s', (requestPath, expected) => {
    expect(safeArtifactPath(requestPath)).toBe(expected);
  });

  it.each(['/blog//post', '/blog/post//', '/./post', '/../post', '/blog/%2e%2e/post', '/blog%2fpost', '/blog%5cpost', '/blog/%'])('rejects unsafe path %s', (requestPath) => {
    try {
      safeArtifactPath(requestPath);
      expect.unreachable('Expected an unsafe_path error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (!(error instanceof AppError)) throw error;
      expect(error.code).toBe('unsafe_path');
      expect(error.status).toBe(400);
    }
  });

  it('resolves both canonical trailing-slash and slashless directory URLs to index.html', async () => {
    const { store } = storeWith({ 'blog/web-interface-guidelines/index.html': '<h1>Post</h1>' });
    await expect(findArtifactObject(store, 'release', '/blog/web-interface-guidelines/')).resolves.toMatchObject({ path: 'blog/web-interface-guidelines/index.html' });
    await expect(findArtifactObject(store, 'release', '/blog/web-interface-guidelines')).resolves.toMatchObject({ path: 'blog/web-interface-guidelines/index.html' });
  });

  it('prefers an exact object before directory index fallback', async () => {
    const { store, readObject } = storeWith({ 'theme.css': 'body{}', 'theme.css/index.html': 'wrong' });
    const found = await findArtifactObject(store, 'release', '/theme.css');
    expect(found?.path).toBe('theme.css');
    expect(readObject).toHaveBeenCalledTimes(1);
  });
});
