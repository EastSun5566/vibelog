import { describe, expect, it } from 'vitest';
import { MAX_PREVIEW_PATH_LENGTH, safePreviewPath } from '../src/preview-path.js';

const origin = 'https://preview.example.com';
describe('preview return paths', () => {
  it.each([
    '//example.net', '/.//example.net', '/a/..//example.net', '/%2e//example.net',
    '/a/%2E%2E//example.net', '/.\\/example.net', '/.\t//example.net',
    'https://example.net/', undefined, '/', `/${'a'.repeat(MAX_PREVIEW_PATH_LENGTH)}`,
  ])('keeps the redirect on the preview origin for %s', (path) => {
    expect(safePreviewPath(path, origin)).toBe('/');
  });

  it.each(['/blog/article/?q=reader#heading', '/blog/中文/', '/a/../blog/article/', '/%2f%2fexample.net'])('preserves a safe normalized path %s', (path) => {
    const result = safePreviewPath(path, origin);
    expect(result).toBe(new URL(path, origin).pathname + new URL(path, origin).search + new URL(path, origin).hash);
    expect(new URL(result, origin).origin).toBe(origin);
    expect(safePreviewPath(result, origin)).toBe(result);
  });
});
