import { describe, expect, it, vi } from 'vitest';
import { HackmdTokenError, hackmdTokenOwner } from '../src/hackmd-identity.js';

const apiUrl = 'https://api.hackmd.example/v1/';

describe('HackMD token owner', () => {
  it('asks /me with the token as a bearer and returns the profile path', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json({ id: 'u1', userPath: 'EastSun5566', email: null })),
    );
    expect(await hackmdTokenOwner('secret-token', { apiUrl, fetch })).toBe('EastSun5566');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://api.hackmd.example/v1/me');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token');
    expect(init?.redirect).toBe('error');
  });
  it('separates a rejected token from HackMD being unavailable', async () => {
    const reply = (response: Response | Error) =>
      hackmdTokenOwner('secret-token', {
        apiUrl,
        fetch: () =>
          response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      }).catch((error: unknown) => error);
    for (const status of [401, 403])
      expect(await reply(new Response(null, { status }))).toMatchObject({ reason: 'invalid' });
    for (const failure of [
      new Response(null, { status: 500 }),
      new Response(null, { status: 429 }),
      Response.json({ name: 'no path' }),
      new Error('timeout'),
    ])
      expect(await reply(failure)).toMatchObject({ reason: 'unavailable' });
  });
  it('never puts the token in its error messages', async () => {
    const error = await hackmdTokenOwner('secret-token', {
      apiUrl,
      fetch: () => Promise.resolve(new Response('secret-token', { status: 401 })),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HackmdTokenError);
    expect(String((error as Error).message)).not.toContain('secret-token');
  });
});
