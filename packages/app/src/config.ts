import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { getAiProviderNames } from '@vibelog/core';

export interface AppConfig {
  nodeEnv: string; dataRoot: string; appOrigin: string; appHostname: string; previewOrigin: string;
  betterAuthSecret: string; betaInviteDigest: Buffer; aiUserDailyLimit: number; aiGlobalDailyLimit: number;
  aiProvider: string; aiModel: string; secureCookies: boolean;
}
function required(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function parseOrigin(value: string): URL { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error('APP_ORIGIN must be an http(s) origin without a path'); return url; }
function positiveInteger(value: string | undefined, fallback: number, name: string): number { const parsed = Number(value ?? fallback); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`); return parsed; }
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const origin = parseOrigin(env.APP_ORIGIN ?? 'http://localhost:3000');
  const betterAuthSecret = required(env, 'BETTER_AUTH_SECRET');
  if (betterAuthSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  const invite = required(env, 'BETA_INVITE_CODE');
  if (invite.length < 24 || invite.length > 512) throw new Error('BETA_INVITE_CODE must be 24–512 characters');
  const aiProvider = env.VIBELOG_AI_PROVIDER ?? 'openai';
  if (!getAiProviderNames().includes(aiProvider)) throw new Error(`VIBELOG_AI_PROVIDER is not in the pi-ai catalog: ${aiProvider}`);
  const previewHost = `preview.${origin.hostname}${origin.port ? `:${origin.port}` : ''}`;
  return { nodeEnv: env.NODE_ENV ?? 'development', dataRoot: resolve(env.DATA_ROOT ?? '.data'), appOrigin: origin.origin, appHostname: origin.hostname, previewOrigin: `${origin.protocol}//${previewHost}`, betterAuthSecret, betaInviteDigest: createHash('sha256').update(invite).digest(), aiUserDailyLimit: positiveInteger(env.VIBELOG_AI_USER_DAILY_LIMIT, 20, 'VIBELOG_AI_USER_DAILY_LIMIT'), aiGlobalDailyLimit: positiveInteger(env.VIBELOG_AI_GLOBAL_DAILY_LIMIT, 200, 'VIBELOG_AI_GLOBAL_DAILY_LIMIT'), aiProvider, aiModel: env.VIBELOG_AI_MODEL ?? 'gpt-4o-mini', secureCookies: origin.protocol === 'https:' };
}
