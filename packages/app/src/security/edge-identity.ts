import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { AppVariables } from '../auth.js';
import { AppError } from '../http.js';

export function edgeIdentity(
  secret: string | undefined,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const host = c.req.header('x-vibelog-host');
    if (!host) {
      const healthProbe =
        c.req.path === '/health' && (c.req.method === 'GET' || c.req.method === 'HEAD');
      if (secret && !healthProbe)
        throw new AppError('edge_identity_required', 'A verified edge identity is required.', 401, {
          'Cache-Control': 'no-store',
        });
      return next();
    }
    const timestamp = c.req.header('x-vibelog-timestamp');
    const signature = c.req.header('x-vibelog-signature-v2');
    const clientKey = c.req.header('x-vibelog-client-key');
    if (
      !secret ||
      !timestamp ||
      !signature ||
      !/^[A-Za-z0-9_-]{43}$/u.test(signature) ||
      !/^\d+$/u.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      (clientKey !== undefined && !/^[A-Za-z0-9_-]{43}$/u.test(clientKey))
    )
      throw new AppError('edge_identity_invalid', 'Invalid edge identity', 401, {
        'Cache-Control': 'no-store',
      });
    const url = new URL(c.req.url);
    const payload = [
      'vibelog-edge-v2',
      timestamp,
      c.req.method,
      host,
      url.pathname + url.search,
      clientKey ?? '',
    ].join('\n');
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right))
      throw new AppError('edge_identity_invalid', 'Invalid edge identity', 401, {
        'Cache-Control': 'no-store',
      });
    c.set('edgeHost', host);
    c.set('edgeClientKey', clientKey);
    return next();
  };
}
