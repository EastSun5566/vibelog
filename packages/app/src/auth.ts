import { createHash, createHmac } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import type { AppConfig } from './config.js';
import type { AppDatabase } from './database.js';
import type { TransactionalEmailSender } from './ports/transactional-email.js';
import { authSchema } from './schema.js';

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAGIC_LINK_TTL_SECONDS = 10 * 60;
export interface AuthUser { id: string; email: string; name: string }
export interface AppSession { id: string; user: AuthUser; csrfToken: string; expiresAt: string }
export interface AppVariables { requestId: string; session: AppSession; edgeHost?: string }

export function createAuth(database: AppDatabase, config: AppConfig, emailSender: TransactionalEmailSender) {
  const socialProviders = {
    ...(config.githubClientId && config.githubClientSecret ? { github: { clientId: config.githubClientId, clientSecret: config.githubClientSecret } } : {}),
    ...(config.googleClientId && config.googleClientSecret ? { google: { clientId: config.googleClientId, clientSecret: config.googleClientSecret } } : {}),
  };
  return betterAuth({
    appName: 'VibeLog', baseURL: config.appOrigin, basePath: '/api/auth', secret: config.betterAuthSecret,
    trustedOrigins: [config.appOrigin], database: drizzleAdapter(database.db, { provider: 'pg', schema: authSchema, transaction: true }),
    socialProviders,
    account: { accountLinking: { enabled: true, trustedProviders: ['google', 'github'] } },
    session: { expiresIn: SESSION_TTL_SECONDS, updateAge: 0 },
    rateLimit: { enabled: false },
    advanced: { database: { generateId: 'uuid' }, cookiePrefix: 'vibelog', defaultCookieAttributes: { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/' } },
    plugins: [magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      sendMagicLink: async ({ email, token, url }) => {
        await emailSender.sendMagicLink({ to: email, url, expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1000), idempotencyKey: createHash('sha256').update(token).digest('hex') });
      },
    })],
  });
}
export type AppAuth = ReturnType<typeof createAuth>;
export async function readSession(c: { req: { raw: Request } }, auth: AppAuth, config: AppConfig): Promise<AppSession | null> {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result) return null;
  return { id: result.session.id, user: { id: result.user.id, email: result.user.email, name: result.user.name }, csrfToken: createHmac('sha256', config.betterAuthSecret).update(`csrf:${result.session.id}`).digest('base64url'), expiresAt: result.session.expiresAt.toISOString() };
}
