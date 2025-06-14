import { FsProvider, HackMdProvider } from '../adapters/content';
import { VercelAiProvider } from '../adapters/ai';
import { ContentProviderName, AiProviderName } from '../consts';

function getProviderInfo<T extends string>(
  providerString: string,
  enumObject: Record<string, T>,
): [T, string] {
  const [name, id] = providerString.split('@');
  const enumValues = Object.values(enumObject);
  if (!Object.values(enumObject).includes(name as T)) {
    throw new Error(`Unknown provider: ${name}. Supported: ${enumValues.join(', ')}`);
  }

  return [name as T, id];
}

export function createContentProvider(providerString: string) {
  const [contentName, handle] = getProviderInfo(providerString, ContentProviderName);
  switch (contentName) {
  case ContentProviderName.HACKMD:
    if (!handle) throw new Error('HackMD username required: hackmd@username');
    return new HackMdProvider(handle);
  case ContentProviderName.FS:
    if (!handle) throw new Error('Content directory required: fs@./content');
    return new FsProvider(handle);
  default:
    throw new Error(`Unsupported content provider: ${contentName as string}. Supported: ${Object.values(ContentProviderName).join(', ')}`);
  }
}

export function createAiProvider(providerString: string) {
  const [providerName, modelId] = getProviderInfo(providerString, AiProviderName);
  return new VercelAiProvider(providerName, modelId);
}
