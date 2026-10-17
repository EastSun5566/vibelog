import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { handleRequest } from '../../packages/edge/dist/index.js';
import { edgeIdentity } from '../../packages/app/dist/security/edge-identity.js';
import { jsonError, requestContext } from '../../packages/app/dist/http.js';

const env = {
  ORIGIN_URL: 'https://origin.example.test',
  ROOT_DOMAIN: 'example.test',
  EDGE_SHARED_SECRET: 'synthetic-edge-smoke-secret',
};
const digest = (payload) =>
  createHmac('sha256', env.EDGE_SHARED_SECRET).update(payload).digest('base64url');
let reached = 0;
const app = new Hono().use('*', requestContext()).use('*', edgeIdentity(env.EDGE_SHARED_SECRET));
app.all('*', (c) => {
  reached += 1;
  c.header('X-Smoke-Method', c.req.method);
  return c.text('verified');
});
app.onError((error, c) => jsonError(c, error));
const originalFetch = globalThis.fetch;
try {
  const scenarios = [
    ['GET', 'https://writer.example.test:8443/blog/post/?b=2&a=%2F'],
    ['HEAD', 'https://writer.example.test:8443/blog/post/?b=2&a=%2F'],
    ['POST', 'https://example.test/api/agent/v1/pairings?b=2&a=%2F'],
    ['OPTIONS', 'https://example.test/api/agent/v1/context'],
  ];
  for (const [method, address] of scenarios) {
    globalThis.fetch = async (input, init) => {
      assert.equal(init.method, method);
      if (method === 'HEAD') {
        assert.equal(init.cache, 'no-store');
        assert.equal(init.cf, undefined);
      }
      const headers = new Headers(init.headers);
      const url = new URL(input);
      assert.equal(headers.has('x-vibelog-signature'), false);
      assert.equal(
        headers.get('x-vibelog-signature-v2'),
        digest(
          [
            'vibelog-edge-v2',
            headers.get('x-vibelog-timestamp'),
            method,
            new URL(address).host,
            url.pathname + url.search,
            headers.get('x-vibelog-client-key') ?? '',
          ].join('\n'),
        ),
      );
      return app.fetch(new Request(input, { ...init, headers }));
    };
    const response = await handleRequest(
      new Request(address, {
        method,
        headers: {
          'cf-connecting-ip': '192.0.2.10',
          'x-vibelog-host': 'forged.example.test',
          'x-vibelog-timestamp': '0',
          'x-vibelog-client-key': 'forged',
          'x-vibelog-signature': 'forged',
          'x-vibelog-signature-v2': 'forged',
        },
      }),
      env,
    );
    assert.equal(response.status, 200, `${method} → V2 origin`);
    assert.equal(response.headers.get('X-Smoke-Method'), method);
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const legacyHeaders = new Headers({
    'x-vibelog-host': 'example.test',
    'x-vibelog-timestamp': timestamp,
  });
  const probe = new URL('/probe', env.ORIGIN_URL);
  const before = reached;
  legacyHeaders.set('x-vibelog-signature', digest(`${timestamp}\nexample.test\n/probe`));
  for (const v2 of [undefined, '', 'invalid']) {
    const headers = new Headers(legacyHeaders);
    if (v2 !== undefined) headers.set('x-vibelog-signature-v2', v2);
    const response = await app.fetch(new Request(probe, { headers }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  for (const tamper of ['method', 'v2']) {
    globalThis.fetch = (input, init) => {
      const headers = new Headers(init.headers);
      if (tamper === 'v2') headers.set('x-vibelog-signature-v2', '');
      return app.fetch(
        new Request(input, {
          ...init,
          headers,
          method: tamper === 'method' ? 'POST' : init.method,
        }),
      );
    };
    const response = await handleRequest(new Request('https://example.test/probe'), env);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(reached, before, 'Rejected requests reached downstream work');
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  'Compiled Worker/origin V2 enforcement, method binding, HEAD and legacy rejection passed.',
);
