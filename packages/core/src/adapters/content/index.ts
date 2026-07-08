export * from './fs';
export * from './hackmd';
export * from './notion';

import { FsSource } from './fs';
import { HackMdSource } from './hackmd';
import { NotionSource } from './notion';
import { ContentSourceName } from '../../consts';
import type { ContentSource } from '../../types';

/**
 * Type-safe factory function to create content sources
 * For programmatic API usage
 */
export function createContentSource(
  name: ContentSourceName,
  handle: string,
): ContentSource {
  switch (name) {
  case ContentSourceName.FS:
    return new FsSource(handle);
  case ContentSourceName.HACKMD:
    return new HackMdSource(handle);
  case ContentSourceName.NOTION:
    return new NotionSource(handle);
  default:
    throw new Error(`Unsupported content source: ${name as string}`);
  }
}
