import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppVariables } from '../src/auth.js';
import { edgeIdentity } from '../src/security/edge-identity.js';
import { jsonError, requestContext } from '../src/http.js';

const secret = 'test-edge-secret';
const clientKey = createHmac('sha256', secret).update('agent-client\n192.0.2.10').digest('base64url');
function signed(client?: string, path = '/api/agent/v1/pairings', timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    'x-vibelog-host': 'vibelog.org', 'x-vibelog-timestamp': timestamp,
    'x-vibelog-signature': createHmac('sha256', secret).update(`${timestamp}\nvibelog.org\n${path}${client ? `\n${client}` : ''}`).digest('base64url'),
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
  it('preserves the existing signed edge protocol', async () => {
    expect(await (await app.request('/api/agent/v1/pairings', { headers: signed() })).json()).toEqual({ host: 'vibelog.org' });
  });
});

function origin(edgeSecret: string | undefined, reached?: () => void) {
  const router = new Hono<{ Variables: AppVariables }>().use('*', requestContext()).use('*', edgeIdentity(edgeSecret));
  router.all('*', (c) => {
    reached?.();
    return c.json({ host: c.get('edgeHost'), client: c.get('edgeClientKey') });
  });
  router.onError((error, c) => jsonError(c, error));
  return router;
}

describe('hosted origin boundary', () => {
  it.each(['/', '/editor', '/auth/login', '/api/auth/get-session', '/api/agent/v1/context', '/preview-access/token', '/blog/post/'])('rejects unsigned %s before downstream work', async (path) => {
    let reached = false;
    const router = origin(secret, () => { reached = true; });
    const response = await router.request(path, { headers: { Host: 'vibelog.org', 'x-vibelog-client-key': clientKey, 'cf-connecting-ip': '192.0.2.10' } });
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'edge_identity_required' } });
    expect(reached).toBe(false);
  });

  it.each(['GET', 'HEAD'])('allows unsigned %s health without trusting identity headers', async (method) => {
    const response = await origin(secret).request('/health', { method, headers: { 'x-vibelog-client-key': clientKey } });
    expect(response.status).toBe(200);
    if (method === 'GET') expect(await response.json()).toEqual({});
    else expect(await response.text()).toBe('');
  });

  it.each([['/health', 'POST'], ['/health', 'OPTIONS'], ['/health/', 'GET'], ['/health/other', 'GET']])('does not exempt %s %s', async (path, method) => {
    expect((await origin(secret).request(path, { method })).status).toBe(401);
  });

  it('still verifies identities on health and binds the path and query', async () => {
    const router = origin(secret);
    expect((await router.request('/health', { headers: signed(undefined, '/health') })).status).toBe(200);
    expect((await router.request('/health', { headers: signed() })).status).toBe(401);
    expect((await router.request('/editor?tab=design', { headers: signed(undefined, '/editor?tab=design') })).status).toBe(200);
    expect((await router.request('/editor?tab=other', { headers: signed(undefined, '/editor?tab=design') })).status).toBe(401);
  });

  it('rejects partial, malformed and expired identities', async () => {
    const valid = signed(clientKey);
    const invalid: Record<string, string>[] = [
      { 'x-vibelog-host': 'vibelog.org' },
      { 'x-vibelog-timestamp': valid['x-vibelog-timestamp'], 'x-vibelog-signature': valid['x-vibelog-signature'] },
      { ...valid, 'x-vibelog-signature': 'invalid' },
      { ...valid, 'x-vibelog-timestamp': 'not-a-timestamp' },
      { ...valid, 'x-vibelog-client-key': 'invalid' },
      signed(clientKey, '/api/agent/v1/pairings', String(Math.floor(Date.now() / 1000) - 301)),
      signed(clientKey, '/api/agent/v1/pairings', String(Math.floor(Date.now() / 1000) + 301)),
    ];
    for (const headers of invalid) expect((await origin(secret).request('/api/agent/v1/pairings', { headers })).status).toBe(401);
  });
});

describe('direct self-hosting', () => {
  it('accepts unsigned requests without trusting caller-supplied proxy identity', async () => {
    const response = await origin(undefined).request('/editor', { headers: { 'x-vibelog-client-key': clientKey, 'cf-connecting-ip': '192.0.2.10' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('does not accept a claimed signed hostname without a configured secret', async () => {
    expect((await origin(undefined).request('/editor', { headers: signed(undefined, '/editor') })).status).toBe(401);
  });
});
