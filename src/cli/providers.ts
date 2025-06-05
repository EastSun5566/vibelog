import { FsProvider, HackMdProvider } from '../adapters/content';
import { OllamaProvider } from '../adapters/ai';
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
  const [type, model] = providerString.split('@');

  switch (type) {
  case 'ollama':
    if (!model) throw new Error('Ollama model required: ollama@model');
    return new OllamaProvider(model);
    // case 'openai':
    //   return new OpenAiProvider(model || 'gpt-4');
  default:
    throw new Error(`Unknown AI provider: ${type}`);
  }
}
