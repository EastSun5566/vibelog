import { randomUUID } from 'node:crypto';
import { loadAppConfig, type AppConfig } from '../src/config.js';
import type { AppDatabase } from '../src/database.js';
import { createApp } from '../src/index.js';
import { user } from '../src/schema.js';

export const TEST_ORIGIN = 'https://app.test';
export const TEST_PASSWORD = 'correct-horse-battery-staple';

export function testConfig(root: string, overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadAppConfig({
    NODE_ENV: 'test',
    DATA_ROOT: root,
    APP_ORIGIN: TEST_ORIGIN,
    PREVIEW_ORIGIN: 'https://preview.test',
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
    VIBELOG_AI_USER_DAILY_LIMIT: '20',
    VIBELOG_AI_GLOBAL_DAILY_LIMIT: '200',
    ...overrides,
  });
}

export function authForm(values: Record<string, string>, origin = TEST_ORIGIN, ip = '192.0.2.1') {
  return {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body: new URLSearchParams(values),
  };
}

export function makeTestApp(root: string, config = testConfig(root)) {
  return createApp({ config });
}

export async function register(instance: ReturnType<typeof makeTestApp>, input: { username?: string; password?: string } = {}) {
  const username = input.username ?? 'alice';
  const password = input.password ?? TEST_PASSWORD;
  const response = await instance.app.request(`${TEST_ORIGIN}/auth/register`, authForm({ username, password }));
  if (response.status !== 303) throw new Error(`Registration failed with ${String(response.status)}: ${await response.text()}`);
  return { username: username.toLowerCase(), password, response, cookie: responseCookie(response) };
}

export async function login(instance: ReturnType<typeof makeTestApp>, username = 'alice', password = TEST_PASSWORD, origin = TEST_ORIGIN, ip = '192.0.2.1') {
  return instance.app.request(`${TEST_ORIGIN}/auth/login`, authForm({ username, password }, origin, ip));
}

export function responseCookie(response: Response): string {
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('Response did not set a cookie');
  return cookie;
}

export function createDatabaseUser(database: AppDatabase, input: { username?: string } = {}) {
  const timestamp = new Date();
  const username = input.username ?? `user_${randomUUID().slice(0, 8)}`;
  const record = {
    id: randomUUID(),
    name: username,
    email: `${username}@users.vibelog.invalid`,
    emailVerified: false,
    image: null,
    username,
    displayUsername: username,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  database.db.insert(user).values(record).run();
  return record;
}
