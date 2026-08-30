import { getAiProviderNames } from '@vibelog/core';

export interface ObjectStoreConfig { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }
export type EmailConfig = { provider: 'resend'; apiKey: string } | { provider: 'mailpit'; apiUrl: string };
export interface OperationRuntimeConfig {
  appOrigin: string; appHostname: string; databaseUrl: string; objectStore: ObjectStoreConfig;
  queueMode: 'direct' | 'postgres' | 'cloud-tasks'; operationPollIntervalMs: number;
  cloudTasks?: { project: string; location: string; queue: string; workerUrl: string; serviceAccountEmail: string };
  taskQueueName?: string; hackmdBaseUrl: string; aiProvider: string; aiModel: string;
}
export interface AppConfig extends OperationRuntimeConfig {
  appOrigin: string; appHostname: string; previewOrigin: string; databaseUrl: string; betterAuthSecret: string;
  githubClientId?: string; githubClientSecret?: string; googleClientId?: string; googleClientSecret?: string;
  email: EmailConfig; emailFrom: string; emailReplyTo: string; objectStore: ObjectStoreConfig;
  edgeSharedSecret?: string;
  aiUserDailyLimit: number; aiGlobalDailyLimit: number; aiProvider: string; aiModel: string; secureCookies: boolean;
}
function required(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function optional(env: NodeJS.ProcessEnv, name: string): string | undefined { const value = env[name]?.trim(); return value && value.length > 0 ? value : undefined; }
function parseOrigin(value: string, name: string): URL { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be an http(s) origin without a path`); return url; }
function positiveInteger(value: string | undefined, fallback: number, name: string): number { const parsed = Number(value ?? fallback); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`); return parsed; }
function boolean(value: string | undefined, fallback: boolean): boolean { if (value === undefined) return fallback; if (value === 'true') return true; if (value === 'false') return false; throw new Error('Boolean configuration must be true or false'); }

function loadOperationRuntimeConfig(env: NodeJS.ProcessEnv): OperationRuntimeConfig {
  const origin = parseOrigin(env.APP_ORIGIN ?? 'http://app.localtest.me:3000', 'APP_ORIGIN');
  const aiProvider = env.VIBELOG_AI_PROVIDER ?? 'openai';
  if (!getAiProviderNames().includes(aiProvider)) throw new Error(`VIBELOG_AI_PROVIDER is not in the pi-ai catalog: ${aiProvider}`);
  const queueMode = env.OPERATION_QUEUE ?? 'direct';
  if (!['direct', 'postgres', 'cloud-tasks'].includes(queueMode)) throw new Error('OPERATION_QUEUE must be direct, postgres, or cloud-tasks');
  const cloudTasks = queueMode === 'cloud-tasks' ? {
    project: required(env, 'CLOUD_TASKS_PROJECT'), location: required(env, 'CLOUD_TASKS_LOCATION'),
    queue: required(env, 'CLOUD_TASKS_QUEUE'), workerUrl: required(env, 'WORKER_URL'),
    serviceAccountEmail: required(env, 'CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL'),
  } : undefined;
  return {
    appOrigin: origin.origin, appHostname: origin.hostname, databaseUrl: required(env, 'DATABASE_URL'),
    objectStore: { endpoint: required(env, 'OBJECT_STORE_ENDPOINT'), region: env.OBJECT_STORE_REGION ?? 'auto', bucket: required(env, 'OBJECT_STORE_BUCKET'), accessKeyId: required(env, 'OBJECT_STORE_ACCESS_KEY_ID'), secretAccessKey: required(env, 'OBJECT_STORE_SECRET_ACCESS_KEY'), forcePathStyle: boolean(env.OBJECT_STORE_FORCE_PATH_STYLE, false) },
    queueMode: queueMode as OperationRuntimeConfig['queueMode'], operationPollIntervalMs: positiveInteger(env.OPERATION_POLL_INTERVAL_MS, 1000, 'OPERATION_POLL_INTERVAL_MS'),
    cloudTasks, taskQueueName: optional(env, 'TASK_QUEUE_NAME'), hackmdBaseUrl: parseOrigin(env.HACKMD_BASE_URL ?? 'https://hackmd.io', 'HACKMD_BASE_URL').origin,
    aiProvider, aiModel: env.VIBELOG_AI_MODEL ?? 'gpt-4o-mini',
  };
}
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): OperationRuntimeConfig { return loadOperationRuntimeConfig(env); }
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const runtime = loadOperationRuntimeConfig(env);
  const origin = new URL(runtime.appOrigin);
  const previewOrigin = optional(env, 'PREVIEW_ORIGIN') ?? `${origin.protocol}//preview.${origin.hostname}${origin.port ? `:${origin.port}` : ''}`;
  parseOrigin(previewOrigin, 'PREVIEW_ORIGIN');
  const betterAuthSecret = required(env, 'BETTER_AUTH_SECRET');
  if (betterAuthSecret.length < 32) throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  const emailProvider = env.EMAIL_PROVIDER ?? 'resend';
  if (!['resend', 'mailpit'].includes(emailProvider)) throw new Error('EMAIL_PROVIDER must be resend or mailpit');
  const email: EmailConfig = emailProvider === 'mailpit'
    ? { provider: 'mailpit', apiUrl: parseOrigin(required(env, 'MAILPIT_API_URL'), 'MAILPIT_API_URL').origin }
    : { provider: 'resend', apiKey: required(env, 'RESEND_API_KEY') };
  return {
    ...runtime, previewOrigin, betterAuthSecret,
    githubClientId: optional(env, 'GITHUB_CLIENT_ID'), githubClientSecret: optional(env, 'GITHUB_CLIENT_SECRET'),
    googleClientId: optional(env, 'GOOGLE_CLIENT_ID'), googleClientSecret: optional(env, 'GOOGLE_CLIENT_SECRET'),
    email, emailFrom: required(env, 'EMAIL_FROM'), emailReplyTo: env.EMAIL_REPLY_TO ?? 'support@example.com',
    edgeSharedSecret: optional(env, 'EDGE_SHARED_SECRET'), aiUserDailyLimit: positiveInteger(env.VIBELOG_AI_USER_DAILY_LIMIT, 20, 'VIBELOG_AI_USER_DAILY_LIMIT'),
    aiGlobalDailyLimit: positiveInteger(env.VIBELOG_AI_GLOBAL_DAILY_LIMIT, 200, 'VIBELOG_AI_GLOBAL_DAILY_LIMIT'), secureCookies: origin.protocol === 'https:',
  };
}
