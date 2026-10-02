import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppVariables } from '../src/auth.js';
import { edgeIdentity } from '../src/security/edge-identity.js';
import { jsonError, requestContext } from '../src/http.js';

const secret = 'test-edge-secret';
const clientKey = createHmac('sha256', secret).update('agent-client\n192.0.2.10').digest('base64url');
function signed(client?: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'x-vibelog-host': 'vibelog.org', 'x-vibelog-timestamp': timestamp,
    'x-vibelog-signature': createHmac('sha256', secret).update(`${timestamp}\nvibelog.org\n/api/agent/v1/pairings${client ? `\n${client}` : ''}`).digest('base64url'),
    ...(client ? { 'x-vibelog-client-key': client } : {}),
  };
}
const app = new Hono<{ Variables: AppVariables }>().use('*', requestContext()).use('*', edgeIdentity(secret))
  .get('/api/agent/v1/pairings', (c) => c.json({ host: c.get('edgeHost'), client: c.get('edgeClientKey') }));
app.onError((error, c) => jsonError(c, error));

describe('verified edge client identity', () => {
  it('trusts the client key only when it is covered by the signature', async () => {
    expect(await (await app.request('/api/agent/v1/pairings', { headers: signed(clientKey) })).json()).toEqual({ host: 'vibelog.org', client: clientKey });
    const tampered = { ...signed(clientKey), 'x-vibelog-client-key': 'a'.repeat(43) };
    expect((await app.request('/api/agent/v1/pairings', { headers: tampered })).status).toBe(401);
    expect((await app.request('/api/agent/v1/pairings', { headers: { ...signed(), 'x-vibelog-client-key': clientKey } })).status).toBe(401);
  });
  it('preserves legacy edge requests but does not trust unsigned identity headers', async () => {
    expect(await (await app.request('/api/agent/v1/pairings', { headers: signed() })).json()).toEqual({ host: 'vibelog.org' });
    expect(await (await app.request('/api/agent/v1/pairings', { headers: { 'x-vibelog-client-key': clientKey, 'cf-connecting-ip': '192.0.2.10' } })).json()).toEqual({});
  });
});
