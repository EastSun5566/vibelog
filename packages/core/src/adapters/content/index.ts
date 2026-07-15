export * from './fs.js';
export * from './hackmd.js';
export * from './notion.js';

import { FsSource } from './fs.js';
import { HackMdSource } from './hackmd.js';
import { NotionSource } from './notion.js';
import { ContentSourceName } from '../../consts.js';
import type { ContentSource } from '../../types.js';

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
