import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { getAiProviderNames } from '@vibelog/core';

export interface OidcSettings {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AppConfig {
  nodeEnv: string;
  dataRoot: string;
  appOrigin: string;
  previewOrigin: string;
  allowedOrigins: Set<string>;
  encryptionKey: Buffer;
  oidc?: OidcSettings;
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

function loadOidcSettings(env: NodeJS.ProcessEnv, production: boolean): OidcSettings | undefined {
  const [issuer, clientId, clientSecret, redirectUri] = [env.OIDC_ISSUER, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET, env.OIDC_REDIRECT_URI];
  if (issuer && clientId && clientSecret && redirectUri) {
    return {
      issuer: new URL(issuer),
      clientId,
      clientSecret,
      redirectUri,
    };
  }

  if (production) {
    throw new Error('OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URI are required in production');
  }

  return undefined;
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
    oidc: loadOidcSettings(env, production),
    aiProvider,
    aiModel: env.VIBELOG_AI_MODEL ?? 'gpt-4o-mini',
    secureCookies: production || appOrigin.startsWith('https://'),
  };
}
