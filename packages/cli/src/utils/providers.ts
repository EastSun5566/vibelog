import {
  createContentSource as createContentSourceFactory,
  createAiProvider as createAiProviderFactory,
  ContentSourceName,
  AiProviderName,
} from '@vibelog/core';

function getInfo<T extends string>(
  infoString: string,
  enumObject: Record<string, T>,
): [T, string] {
  const separator = infoString.indexOf('@');
  if (separator <= 0 || separator === infoString.length - 1) {
    throw new Error('Provider must use the format name@handle');
  }
  const name = infoString.slice(0, separator);
  const id = infoString.slice(separator + 1);
  const enumValues = Object.values(enumObject);
  if (!Object.values(enumObject).includes(name as T)) {
    throw new Error(`Unknown provider: ${name}. Supported: ${enumValues.join(', ')}`);
  }

  return [name as T, id];
}

/**
 * CLI-specific string parsing wrapper
 * Parses "fs@./content" format into ContentSource
 */
export function createContentSource(contentString: string) {
  const [contentName, handle] = getInfo(contentString, ContentSourceName);
  return createContentSourceFactory(contentName, handle);
}

/**
 * CLI-specific string parsing wrapper
 * Parses "openai@gpt-4o-mini" format into AiProvider
 */
export function createAiProvider(providerString: string) {
  const [providerName, modelId] = getInfo(providerString, AiProviderName);
  return createAiProviderFactory(providerName, modelId);
}
