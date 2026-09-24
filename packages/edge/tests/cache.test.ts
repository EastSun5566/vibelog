import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/index.js';

const env = { ORIGIN_URL: 'https://origin.run.test', EDGE_SHARED_SECRET: 'secret', ROOT_DOMAIN: 'example.com' };

afterEach(() => vi.restoreAllMocks());

async function forwarded(url: string, method = 'GET'): Promise<RequestInit> {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
  await handleRequest(new Request(url, { method }), env);
  return fetch.mock.calls[0]?.[1] ?? {};
}

describe('public blog edge cache', () => {
  it('caches first-level public hosts for 60 seconds with an isolated full-URL key', async () => {
    const init = await forwarded('https://writer.example.com/blog/post/?ref=home');
    expect(init.cf).toEqual({
      cacheEverything: true,
      cacheKey: 'https://writer.example.com/blog/post/?ref=home',
      cacheTtlByStatus: { '200-299': 60, '300-599': 0 },
    });
  });

  it.each([
    ['https://example.com/', 'GET'],
    ['https://preview.example.com/', 'GET'],
    ['https://nested.writer.example.com/', 'GET'],
    ['https://writer.example.com/', 'POST'],
  ])('bypasses cache for %s %s', async (url, method) => {
    expect((await forwarded(url, method)).cf).toBeUndefined();
  });
});

describe('edge maintenance gate', () => {
  it.each(['draining', 'locked'])('blocks every host before reaching origin in %s', async (stage) => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const url of ['https://example.com/', 'https://writer.example.com/blog/', 'https://preview.example.com/']) {
      const response = await handleRequest(new Request(url), { ...env, MAINTENANCE_STAGE: stage });
      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves health reachable and HEAD responses empty', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    expect((await handleRequest(new Request('https://example.com/health'), { ...env, MAINTENANCE_STAGE: 'locked' })).status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    const response = await handleRequest(new Request('https://writer.example.com/', { method: 'HEAD' }), { ...env, MAINTENANCE_STAGE: 'locked' });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });
});
