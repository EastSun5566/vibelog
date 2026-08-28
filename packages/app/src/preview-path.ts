export const MAX_PREVIEW_PATH_LENGTH = 2048;

export function safePreviewPath(value: unknown, previewOrigin: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PREVIEW_PATH_LENGTH || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const origin = new URL(previewOrigin).origin;
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}

export function editorUrlWithPreviewPath(path: string): string {
  return path === '/' ? '/editor' : `/editor?${new URLSearchParams({ previewPath: path }).toString()}`;
}
