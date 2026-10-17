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
const legacyPayload = (url, headers) =>
  `${headers.get('x-vibelog-timestamp')}\n${headers.get('x-vibelog-host')}\n${url.pathname}${url.search}${headers.has('x-vibelog-client-key') ? `\n${headers.get('x-vibelog-client-key')}` : ''}`;
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
    for (const consumer of ['legacy', 'dual', 'v2-only']) {
      globalThis.fetch = async (input, init) => {
        assert.equal(init.method, method);
        if (method === 'HEAD') {
          assert.equal(init.cache, 'no-store');
          assert.equal(init.cf, undefined);
        }
        const headers = new Headers(init.headers);
        // Freeze the old receiver's wire contract independently of the current verifier.
        assert.equal(
          headers.get('x-vibelog-signature'),
          digest(legacyPayload(new URL(input), headers)),
        );
        assert.match(headers.get('x-vibelog-signature-v2'), /^[A-Za-z0-9_-]{43}$/);
        if (consumer === 'legacy') return new Response(null, { status: 200 });
        if (consumer === 'v2-only') headers.delete('x-vibelog-signature');
        return app.fetch(new Request(input, { ...init, headers }));
      };
      const response = await handleRequest(
        new Request(address, {
          method,
          headers: { 'cf-connecting-ip': '192.0.2.10', 'x-vibelog-signature-v2': 'forged' },
        }),
        env,
      );
      assert.equal(response.status, 200, `${method} → ${consumer}`);
      if (consumer !== 'legacy') assert.equal(response.headers.get('X-Smoke-Method'), method);
    }
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const legacyHeaders = new Headers({
    'x-vibelog-host': 'example.test',
    'x-vibelog-timestamp': timestamp,
  });
  const probe = new URL('/probe', env.ORIGIN_URL);
  legacyHeaders.set('x-vibelog-signature', digest(legacyPayload(probe, legacyHeaders)));
  assert.equal((await app.fetch(new Request(probe, { headers: legacyHeaders }))).status, 200);

  const before = reached;
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
  'Compiled Worker/origin signature compatibility, method binding, HEAD and downgrade guards passed.',
);
