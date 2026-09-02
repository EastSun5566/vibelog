import { afterEach, describe, expect, it, vi } from 'vitest';
import { magicLinkIdempotencyKey } from '../src/auth.js';
import { ResendTransactionalEmailSender } from '../src/adapters/resend-email.js';

afterEach(() => vi.unstubAllGlobals());
describe('ResendTransactionalEmailSender', () => {
  it('sends HTML, text, reply-to and a stable idempotency key', async () => {
    let captured: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (typeof init?.body !== 'string') return Promise.reject(new Error('Expected JSON request body'));
      captured = { url, headers: new Headers(init.headers), body: JSON.parse(init.body) as Record<string, unknown> };
      return Promise.resolve(new Response(JSON.stringify({ id: 'email-id' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }));
    const sender = new ResendTransactionalEmailSender('re_test', 'VibeLog <login@send.example.com>', 'support@example.com');
    await sender.sendMagicLink({ to: 'writer@example.com', url: 'https://app.example.com/api/auth/magic-link/verify?token=secret', expiresAt: new Date('2026-08-29T00:10:00Z'), idempotencyKey: 'magic-link/hashed-token' });
    expect(captured?.url).toContain('/emails'); expect(captured?.headers.get('idempotency-key')).toBe('magic-link/hashed-token');
    expect(captured?.body).toMatchObject({ to: 'writer@example.com', reply_to: 'support@example.com', subject: 'Your VibeLog sign-in link' });
    expect(captured?.body.html).toContain('10 minutes'); expect(captured?.body.text).toContain('If you did not request');
  });

  it('uses the documented event/entity idempotency format without exposing the token', () => {
    const key = magicLinkIdempotencyKey('secret-token');
    expect(key).toMatch(/^magic-link\/[a-f0-9]{64}$/);
    expect(key).not.toContain('secret-token');
  });

  it('retries network, rate-limit, and server failures with one and two second backoff', async () => {
    const scenarios = [
      [() => Promise.reject(new Error('socket closed'))],
      [
        () => Promise.resolve(new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 }), { status: 429, headers: { 'content-type': 'application/json' } })),
        () => Promise.resolve(new Response(JSON.stringify({ name: 'internal_server_error', message: 'try again', statusCode: 500 }), { status: 500, headers: { 'content-type': 'application/json' } })),
      ],
    ];
    for (const failures of scenarios) {
      const delays: number[] = [];
      const fetchMock = vi.fn();
      for (const failure of failures) fetchMock.mockImplementationOnce(failure);
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'email-id' }), { status: 200, headers: { 'content-type': 'application/json' } }));
      vi.stubGlobal('fetch', fetchMock);
      const sender = new ResendTransactionalEmailSender('re_test', 'login@send.example.com', 'support@example.com', undefined, (milliseconds) => { delays.push(milliseconds); return Promise.resolve(); });
      await sender.sendMagicLink({ to: 'writer@example.com', url: 'https://example.com/magic', expiresAt: new Date(), idempotencyKey: 'magic-link/stable' });
      expect(fetchMock).toHaveBeenCalledTimes(failures.length + 1);
      expect(delays).toEqual(failures.length === 1 ? [1000] : [1000, 2000]);
    }
  });

  it('does not retry validation or idempotency conflicts', async () => {
    for (const [status, name] of [[422, 'validation_error'], [409, 'invalid_idempotent_request']] as const) {
      const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ name, message: 'rejected', statusCode: status }), { status, headers: { 'content-type': 'application/json' } })));
      vi.stubGlobal('fetch', fetchMock);
      const sender = new ResendTransactionalEmailSender('re_test', 'login@send.example.com', 'support@example.com', undefined, () => Promise.reject(new Error('delay should not run')));
      await expect(sender.sendMagicLink({ to: 'writer@example.com', url: 'https://example.com/magic', expiresAt: new Date(), idempotencyKey: 'magic-link/stable' })).rejects.toThrow('Transactional email rejected');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});
