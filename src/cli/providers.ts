import { FsProvider, HackMdProvider } from '../adapters/content';
import { VercelAiProvider } from '../adapters/ai';
import { ContentSourceName, AiProviderName } from '../consts';

function getInfo<T extends string>(
  infoString: string,
  enumObject: Record<string, T>,
): [T, string] {
  const [name, id] = infoString.split('@');
  const enumValues = Object.values(enumObject);
  if (!Object.values(enumObject).includes(name as T)) {
    throw new Error(`Unknown provider: ${name}. Supported: ${enumValues.join(', ')}`);
  }

  return [name as T, id];
}

export function createContentSource(contentString: string) {
  const [contentName, handle] = getInfo(contentString, ContentSourceName);
  switch (contentName) {
  case ContentSourceName.HACKMD:
    return new HackMdProvider(handle);
  case ContentSourceName.FS:
    return new FsProvider(handle);
  default:
    throw new Error(`Unsupported content source: ${contentName as string}. Supported: ${Object.values(ContentSourceName).join(', ')}`);
  }
}

export function createAiProvider(providerString: string) {
  const [providerName, modelId] = getInfo(providerString, AiProviderName);
  return new VercelAiProvider(providerName, modelId);
}
