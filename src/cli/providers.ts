import { FsProvider, HackMdProvider } from '../adapters/content';
import { VercelAiProvider } from '../adapters/ai';
import type { ContentProvider, AiProvider } from '../types';

export function createContentProvider(providerString: string): ContentProvider {
  const [contentName, handle] = providerString.split('@');
  switch (contentName) {
  case 'hackmd':
    if (!handle) throw new Error('HackMD username required: hackmd@username');
    return new HackMdProvider(handle);
  case 'fs':
    return new FsProvider(handle || './content');
  default:
    throw new Error(`Unknown content provider: ${contentName}`);
  }
}

export function createAiProvider(providerString: string): AiProvider {
  const [providerName, modelId] = providerString.split('@');
  return new VercelAiProvider(providerName, modelId);
}
