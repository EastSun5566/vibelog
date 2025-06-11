import { FsProvider, HackMdProvider } from '../adapters/content';
import { VercelAiProvider } from '../adapters/ai';
import type { ContentProvider, AiProvider } from '../types';

export function createContentProvider(providerString: string): ContentProvider {
  const [type, config] = providerString.split('@');

  switch (type) {
  case 'hackmd':
    if (!config) throw new Error('HackMD username required: hackmd@username');
    return new HackMdProvider(config);
  case 'fs':
    return new FsProvider(config || './content');
  default:
    throw new Error(`Unknown content provider: ${type}`);
  }
}

export function createAiProvider(providerString: string): AiProvider {
  const [providerName, modelName] = providerString.split('@');
  return new VercelAiProvider(providerName, modelName);
}
