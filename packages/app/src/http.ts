import { randomUUID } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppConfig } from './config.js';
import type { AppVariables } from './auth.js';

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: ContentfulStatusCode,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
  }
}

export function requestContext(): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    c.set('requestId', randomUUID());
    c.set('cspNonce', randomUUID().replaceAll('-', ''));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    await next();
    c.header('X-Request-Id', c.get('requestId'));
  };
}

export function corsPolicy(config: AppConfig): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    const requestOrigin = new URL(c.req.url).origin;
    if (origin && origin !== requestOrigin && !config.allowedOrigins.has(origin)) {
      throw new AppError('origin_not_allowed', 'Request origin is not allowed', 403);
    }
    if (origin && origin !== requestOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Vary', 'Origin');
    }
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Captcha-Response');
      return c.body(null, 204);
    }
    await next();
  };
}

export function assertMutationOrigin(c: Context, config: AppConfig): void {
  const origin = c.req.header('origin');
  if (!origin || !config.allowedOrigins.has(origin)) {
    throw new AppError('invalid_origin', 'A trusted Origin header is required', 403);
  }
}

export function assertCsrfToken(actual: string | undefined, expected: string): void {
  if (!actual || actual !== expected) {
    throw new AppError('invalid_csrf_token', 'CSRF token is missing or invalid', 403);
  }
}

export function jsonError(c: Context<{ Variables: AppVariables }>, error: unknown) {
  const requestId = c.get('requestId') || randomUUID();
  if (error instanceof AppError) {
    for (const [name, value] of Object.entries(error.headers ?? {})) c.header(name, value);
    return c.json({ error: { code: error.code, message: error.message, requestId } }, error.status);
  }

  console.error(`[${requestId}]`, error);
  return c.json({
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred',
      requestId,
    },
  }, 500);
}
