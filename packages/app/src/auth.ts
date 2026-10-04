import { createHash, createHmac } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './database.js';
import type { TransactionalEmailSender } from './ports/transactional-email.js';
import { authSchema } from './schema.js';

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAGIC_LINK_TTL_SECONDS = 10 * 60;
const magicLinkBody = z.looseObject({ email: z.string().trim().toLowerCase().pipe(z.email().max(320)) });
export function emailRateLimitKey(secret: string, email: string): string {
  return createHash('sha256').update(secret).update('\0').update(email.trim().toLowerCase()).digest('base64url');
}
export function magicLinkIdempotencyKey(token: string): string {
  return `magic-link/${createHash('sha256').update(token).digest('hex')}`;
}
export interface AuthUser { id: string; email: string; name: string }
export interface AppSession { id: string; user: AuthUser; csrfToken: string; expiresAt: string }
export interface AppVariables { requestId: string; session: AppSession; edgeHost?: string; edgeClientKey?: string }

export function createAuth(database: AppDatabase, config: AppConfig, emailSender: TransactionalEmailSender) {
  const socialProviders = {
    ...(config.githubClientId && config.githubClientSecret ? { github: { clientId: config.githubClientId, clientSecret: config.githubClientSecret } } : {}),
    ...(config.googleClientId && config.googleClientSecret ? { google: { clientId: config.googleClientId, clientSecret: config.googleClientSecret } } : {}),
  };
  return betterAuth({
    appName: 'VibeLog', baseURL: config.appOrigin, basePath: '/api/auth', secret: config.betterAuthSecret,
    trustedOrigins: [config.appOrigin], database: drizzleAdapter(database.db, { provider: 'pg', schema: authSchema, transaction: true }),
    socialProviders,
    account: { accountLinking: { enabled: true, requireLocalEmailVerified: true } },
    session: { expiresIn: SESSION_TTL_SECONDS, updateAge: 60 * 60 },
    rateLimit: { enabled: false },
    hooks: { before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/magic-link') return;
      const body: unknown = ctx.body;
      const parsed = magicLinkBody.safeParse(body);
      if (!parsed.success) throw new APIError('BAD_REQUEST', { message: 'Enter a valid email address.' });
      const key = emailRateLimitKey(config.betterAuthSecret, parsed.data.email);
      if (!await database.consumeRateLimit(`magic:minute:${key}`, 1, 60) || !await database.consumeRateLimit(`magic:hour:${key}`, 3, 3600)) {
        throw new APIError('TOO_MANY_REQUESTS', { message: 'Please wait before requesting another link.' });
      }
      return { context: { body: parsed.data } };
    }) },
    advanced: { database: { generateId: 'uuid' }, cookiePrefix: 'vibelog', defaultCookieAttributes: { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/' } },
    plugins: [magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      storeToken: 'hashed',
      sendMagicLink: async ({ email, token, url }) => {
        await emailSender.sendMagicLink({ to: email, url, expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000), idempotencyKey: magicLinkIdempotencyKey(token) });
      },
    })],
  });
}
export type AppAuth = ReturnType<typeof createAuth>;
export async function readSession(c: Pick<Context, 'req' | 'header'>, auth: AppAuth, config: AppConfig): Promise<AppSession | null> {
  c.header('Cache-Control', 'private, no-store');
  const { response: result, headers } = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true });
  for (const cookie of headers.getSetCookie()) c.header('Set-Cookie', cookie, { append: true });
  if (!result) return null;
  return { id: result.session.id, user: { id: result.user.id, email: result.user.email, name: result.user.name }, csrfToken: createHmac('sha256', config.betterAuthSecret).update(`csrf:${result.session.id}`).digest('base64url'), expiresAt: result.session.expiresAt.toISOString() };
}
