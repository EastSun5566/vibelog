import { createHmac } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { username } from 'better-auth/plugins';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './database.js';
import { authSchema } from './schema.js';

const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface AuthUser {
  id: string;
  username: string;
}

export interface AppSession {
  id: string;
  user: AuthUser;
  csrfToken: string;
  expiresAt: string;
}

export interface AppVariables {
  requestId: string;
  session: AppSession;
}

export function createAuth(database: AppDatabase, config: AppConfig) {
  return betterAuth({
    appName: 'VibeLog',
    baseURL: config.appOrigin,
    basePath: '/api/auth',
    secret: config.betterAuthSecret,
    trustedOrigins: [config.appOrigin],
    disabledPaths: [
      '/sign-in/email',
      '/request-password-reset',
      '/reset-password',
      '/send-verification-email',
      '/verify-email',
    ],
    database: drizzleAdapter(database.db, {
      provider: 'sqlite',
      schema: authSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 0,
    },
    // Render's trusted client-IP header has not been verified yet. Route-level
    // account/global limits live in AppDatabase so raw forwarding headers are
    // never treated as an identity boundary.
    rateLimit: { enabled: false },
    advanced: {
      database: { generateId: 'uuid' },
      cookiePrefix: 'vibelog',
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
        path: '/',
      },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameNormalization: (value) => value.toLowerCase(),
        validationOrder: { username: 'post-normalization' },
        usernameValidator: (value) => /^[a-z0-9_-]{3,32}$/.test(value),
      }),
    ],
  });
}

export type AppAuth = ReturnType<typeof createAuth>;

export async function readSession(c: { req: { raw: Request } }, auth: AppAuth, config: AppConfig): Promise<AppSession | null> {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result || typeof result.user.username !== 'string') return null;
  return {
    id: result.session.id,
    user: { id: result.user.id, username: result.user.username },
    csrfToken: createHmac('sha256', config.betterAuthSecret).update(`csrf:${result.session.id}`).digest('base64url'),
    expiresAt: result.session.expiresAt.toISOString(),
  };
}
