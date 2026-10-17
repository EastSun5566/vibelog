import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppVariables } from '../src/auth.js';
import { edgeIdentity } from '../src/security/edge-identity.js';
import { jsonError, requestContext } from '../src/http.js';

const secret = 'test-edge-secret';
const clientKey = createHmac('sha256', secret)
  .update('agent-client\n192.0.2.10')
  .digest('base64url');
function signed(
  client?: string,
  path = '/api/agent/v1/pairings',
  timestamp = String(Math.floor(Date.now() / 1000)),
  method = 'GET',
) {
  return {
    'x-vibelog-host': 'vibelog.org',
    'x-vibelog-timestamp': timestamp,
    'x-vibelog-signature-v2': createHmac('sha256', secret)
      .update(['vibelog-edge-v2', timestamp, method, 'vibelog.org', path, client ?? ''].join('\n'))
      .digest('base64url'),
    ...(client ? { 'x-vibelog-client-key': client } : {}),
  };
}
const app = new Hono<{ Variables: AppVariables }>()
  .use('*', requestContext())
  .use('*', edgeIdentity(secret))
  .get('/api/agent/v1/pairings', (c) =>
    c.json({ host: c.get('edgeHost'), client: c.get('edgeClientKey') }),
  );
app.onError((error, c) => jsonError(c, error));

describe('verified edge client identity', () => {
  it('trusts the client key only when it is covered by the signature', async () => {
    expect(
      await (await app.request('/api/agent/v1/pairings', { headers: signed(clientKey) })).json(),
    ).toEqual({ host: 'vibelog.org', client: clientKey });
    const tampered = { ...signed(clientKey), 'x-vibelog-client-key': 'a'.repeat(43) };
    expect((await app.request('/api/agent/v1/pairings', { headers: tampered })).status).toBe(401);
    expect(
      (
        await app.request('/api/agent/v1/pairings', {
          headers: { ...signed(), 'x-vibelog-client-key': clientKey },
        })
      ).status,
    ).toBe(401);
  });
  it('accepts V2 without an optional client key', async () => {
    expect(
      await (await app.request('/api/agent/v1/pairings', { headers: signed() })).json(),
    ).toEqual({ host: 'vibelog.org' });
  });
});

function origin(edgeSecret: string | undefined, reached?: () => void) {
  const router = new Hono<{ Variables: AppVariables }>()
    .use('*', requestContext())
    .use('*', edgeIdentity(edgeSecret));
  router.all('*', (c) => {
    reached?.();
    return c.json({ host: c.get('edgeHost'), client: c.get('edgeClientKey') });
  });
  router.onError((error, c) => jsonError(c, error));
  return router;
}

function signedV2(
  method = 'GET',
  path = '/probe?b=2&a=%2F',
  client?: string,
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  return signed(client, path, timestamp, method);
}

describe('required method-bound edge identity', () => {
  it.each(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'accepts V2 signatures for %s',
    async (method) => {
      const headers = signedV2(method);
      const router = origin(secret);
      expect((await router.request('/probe?b=2&a=%2F', { method, headers })).status).toBe(200);
    },
  );

  it.each([undefined, '', 'invalid'])('rejects legacy-only or invalid V2: %j', async (v2) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      'x-vibelog-host': 'vibelog.org',
      'x-vibelog-timestamp': timestamp,
      'x-vibelog-signature': createHmac('sha256', secret)
        .update(`${timestamp}\nvibelog.org\n/probe?b=2&a=%2F`)
        .digest('base64url'),
    };
    if (v2 !== undefined) headers['x-vibelog-signature-v2'] = v2;
    let reached = false;
    const response = await origin(secret, () => {
      reached = true;
    }).request('/probe?b=2&a=%2F', { headers });
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(reached).toBe(false);
    expect(await response.json()).toMatchObject({ error: { code: 'edge_identity_invalid' } });
  });

  it('does not require or validate the legacy signature when V2 is valid', async () => {
    const headers = { ...signedV2(), 'x-vibelog-signature': 'invalid' };
    expect((await origin(secret).request('/probe?b=2&a=%2F', { headers })).status).toBe(200);
  });

  it.each([
    '',
    'invalid',
    'a'.repeat(43),
    `${'a'.repeat(43)}=`,
    `${'a'.repeat(43)},${'b'.repeat(43)}`,
  ])('never downgrades a present invalid V2 signature: %j', async (signature) => {
    let reached = false;
    const response = await origin(secret, () => {
      reached = true;
    }).request('/probe?b=2&a=%2F', {
      headers: { ...signedV2(), 'x-vibelog-signature-v2': signature },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(reached).toBe(false);
    expect(await response.json()).toMatchObject({ error: { code: 'edge_identity_invalid' } });
  });

  it.each(['HEAD', 'POST'])(
    'rejects a GET signature on %s before downstream work',
    async (method) => {
      let reached = false;
      const response = await origin(secret, () => {
        reached = true;
      }).request('/probe?b=2&a=%2F', {
        method,
        headers: signedV2(),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(reached).toBe(false);
    },
  );

  it('binds the host, raw path/query, timestamp and optional client key', async () => {
    const router = origin(secret);
    const headers = signedV2('GET', '/probe?b=2&a=%2F', clientKey);
    expect(await (await router.request('/probe?b=2&a=%2F', { headers })).json()).toEqual({
      host: 'vibelog.org',
      client: clientKey,
    });
    for (const changed of [
      { ...headers, 'x-vibelog-host': 'other.vibelog.org' },
      { ...headers, 'x-vibelog-timestamp': String(Number(headers['x-vibelog-timestamp']) - 1) },
      { ...headers, 'x-vibelog-client-key': 'a'.repeat(43) },
      { ...headers, 'x-vibelog-client-key': '' },
    ])
      expect((await router.request('/probe?b=2&a=%2F', { headers: changed })).status).toBe(401);
    const missingClient: Record<string, string> = { ...headers };
    delete missingClient['x-vibelog-client-key'];
    expect((await router.request('/probe?b=2&a=%2F', { headers: missingClient })).status).toBe(401);
    for (const path of ['/changed?b=2&a=%2F', '/probe?a=%2F&b=2', '/probe?b=3&a=%2F'])
      expect((await router.request(path, { headers })).status).toBe(401);
  });

  it.each([-301, 301])(
    'rejects a correctly signed V2 timestamp outside the window: %i',
    async (offset) => {
      const timestamp = String(Math.floor(Date.now() / 1000) + offset);
      const response = await origin(secret).request('/probe?b=2&a=%2F', {
        headers: signedV2('GET', undefined, undefined, timestamp),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    },
  );

  it('preserves signed health verification and rejects claimed V2 identity in self-hosting', async () => {
    const headers = signedV2('GET', '/health');
    expect((await origin(secret).request('/health', { headers })).status).toBe(200);
    expect((await origin(undefined).request('/health', { headers })).status).toBe(401);
    expect(
      (
        await origin(secret).request('/health', {
          headers: { ...headers, 'x-vibelog-signature-v2': '' },
        })
      ).status,
    ).toBe(401);
  });
});

describe('hosted origin boundary', () => {
  it.each([
    '/',
    '/editor',
    '/auth/login',
    '/api/auth/get-session',
    '/api/agent/v1/context',
    '/preview-access/token',
    '/blog/post/',
  ])('rejects unsigned %s before downstream work', async (path) => {
    let reached = false;
    const router = origin(secret, () => {
      reached = true;
    });
    const response = await router.request(path, {
      headers: {
        Host: 'vibelog.org',
        'x-vibelog-client-key': clientKey,
        'cf-connecting-ip': '192.0.2.10',
      },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'edge_identity_required' } });
    expect(reached).toBe(false);
  });

  it.each(['GET', 'HEAD'])(
    'allows unsigned %s health without trusting identity headers',
    async (method) => {
      const response = await origin(secret).request('/health', {
        method,
        headers: { 'x-vibelog-client-key': clientKey },
      });
      expect(response.status).toBe(200);
      if (method === 'GET') expect(await response.json()).toEqual({});
      else expect(await response.text()).toBe('');
    },
  );

  it.each([
    ['/health', 'POST'],
    ['/health', 'OPTIONS'],
    ['/health/', 'GET'],
    ['/health/other', 'GET'],
  ])('does not exempt %s %s', async (path, method) => {
    expect((await origin(secret).request(path, { method })).status).toBe(401);
  });

  it('still verifies identities on health and binds the path and query', async () => {
    const router = origin(secret);
    expect(
      (await router.request('/health', { headers: signed(undefined, '/health') })).status,
    ).toBe(200);
    expect((await router.request('/health', { headers: signed() })).status).toBe(401);
    expect(
      (
        await router.request('/editor?tab=design', {
          headers: signed(undefined, '/editor?tab=design'),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await router.request('/editor?tab=other', {
          headers: signed(undefined, '/editor?tab=design'),
        })
      ).status,
    ).toBe(401);
  });

  it('rejects partial, malformed and expired identities', async () => {
    const valid = signed(clientKey);
    const invalid: Record<string, string>[] = [
      { 'x-vibelog-host': 'vibelog.org' },
      {
        'x-vibelog-timestamp': valid['x-vibelog-timestamp'],
        'x-vibelog-signature-v2': valid['x-vibelog-signature-v2'],
      },
      { ...valid, 'x-vibelog-signature-v2': 'invalid' },
      { ...valid, 'x-vibelog-timestamp': 'not-a-timestamp' },
      { ...valid, 'x-vibelog-client-key': 'invalid' },
      signed(clientKey, '/api/agent/v1/pairings', String(Math.floor(Date.now() / 1000) - 301)),
      signed(clientKey, '/api/agent/v1/pairings', String(Math.floor(Date.now() / 1000) + 301)),
    ];
    for (const headers of invalid)
      expect((await origin(secret).request('/api/agent/v1/pairings', { headers })).status).toBe(
        401,
      );
  });
});

describe('direct self-hosting', () => {
  it('accepts unsigned requests without trusting caller-supplied proxy identity', async () => {
    const response = await origin(undefined).request('/editor', {
      headers: { 'x-vibelog-client-key': clientKey, 'cf-connecting-ip': '192.0.2.10' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('does not accept a claimed signed hostname without a configured secret', async () => {
    expect(
      (await origin(undefined).request('/editor', { headers: signed(undefined, '/editor') }))
        .status,
    ).toBe(401);
  });
});
