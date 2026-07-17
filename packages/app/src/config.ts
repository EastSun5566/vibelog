import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { getAiProviderNames } from '@vibelog/core';

export interface AppConfig {
  nodeEnv: string;
  dataRoot: string;
  appOrigin: string;
  previewOrigin: string;
  allowedOrigins: Set<string>;
  encryptionKey: Buffer;
  betterAuthSecret: string;
  aiUserDailyLimit: number;
  aiGlobalDailyLimit: number;
  aiProvider: string;
  aiModel: string;
  secureCookies: boolean;
}

function parseOrigin(value: string, name: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an http(s) origin without a path`);
  }
  return url.origin;
}

function parseEncryptionKey(env: NodeJS.ProcessEnv, production: boolean): Buffer {
  const encoded = env.APP_ENCRYPTION_KEY;
  if (encoded) {
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    return key;
  }

  if (production) {
    throw new Error('APP_ENCRYPTION_KEY is required in production');
  }

  const developmentSecret = env.SESSION_SECRET ?? 'vibelog-development-only-secret';
  return createHash('sha256').update(developmentSecret).digest();
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseBetterAuthSecret(env: NodeJS.ProcessEnv): string {
  const secret = required(env, 'BETTER_AUTH_SECRET');
  if (secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  return secret;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';
  const appOrigin = parseOrigin(env.APP_ORIGIN ?? 'http://localhost:3000', 'APP_ORIGIN');
  const previewOrigin = parseOrigin(env.PREVIEW_ORIGIN ?? 'http://preview.localhost:3000', 'PREVIEW_ORIGIN');
  const extraOrigins = (env.APP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseOrigin(origin, 'APP_ALLOWED_ORIGINS'));
  const aiProvider = env.VIBELOG_AI_PROVIDER ?? 'openai';
  if (!getAiProviderNames().includes(aiProvider)) {
    throw new Error(`VIBELOG_AI_PROVIDER is not in the pi-ai catalog: ${aiProvider}`);
  }

  return {
    nodeEnv,
    dataRoot: resolve(env.DATA_ROOT ?? '.data'),
    appOrigin,
    previewOrigin,
    allowedOrigins: new Set([appOrigin, ...extraOrigins]),
    encryptionKey: parseEncryptionKey(env, production),
    betterAuthSecret: parseBetterAuthSecret(env),
    aiUserDailyLimit: positiveInteger(env.VIBELOG_AI_USER_DAILY_LIMIT, 20, 'VIBELOG_AI_USER_DAILY_LIMIT'),
    aiGlobalDailyLimit: positiveInteger(env.VIBELOG_AI_GLOBAL_DAILY_LIMIT, 200, 'VIBELOG_AI_GLOBAL_DAILY_LIMIT'),
    aiProvider,
    aiModel: env.VIBELOG_AI_MODEL ?? 'gpt-4o-mini',
    secureCookies: production || appOrigin.startsWith('https://'),
  };
}
