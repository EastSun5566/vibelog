import { afterEach, describe, expect, it, vi } from 'vitest';
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
    await sender.sendMagicLink({ to: 'writer@example.com', url: 'https://app.example.com/api/auth/magic-link/verify?token=secret', expiresAt: new Date('2026-08-29T00:10:00Z'), idempotencyKey: 'hashed-token' });
    expect(captured?.url).toContain('/emails'); expect(captured?.headers.get('idempotency-key')).toBe('hashed-token');
    expect(captured?.body).toMatchObject({ to: 'writer@example.com', reply_to: 'support@example.com', subject: 'Your VibeLog sign-in link' });
    expect(captured?.body.html).toContain('10 minutes'); expect(captured?.body.text).toContain('If you did not request');
  });
});
