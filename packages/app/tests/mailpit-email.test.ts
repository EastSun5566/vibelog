import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailpitTransactionalEmailSender } from '../src/adapters/mailpit-email.js';

afterEach(() => vi.unstubAllGlobals());

describe('MailpitTransactionalEmailSender', () => {
  it('sends the same magic-link content to the local Mailpit API', async () => {
    let captured: { url: string; body: Record<string, unknown> } | undefined;
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') return Promise.reject(new Error('Expected JSON request body'));
      captured = {
        url: input instanceof Request ? input.url : input.toString(),
        body: JSON.parse(init.body) as Record<string, unknown>,
      };
      return Promise.resolve(Response.json({ ID: 'message-id' }));
    }));
    const sender = new MailpitTransactionalEmailSender('http://mailpit:8025', 'VibeLog <login@send.example.com>', 'support@example.com');
    await sender.sendMagicLink({
      to: 'writer@example.com',
      url: 'http://app.localtest.me:3000/api/auth/magic-link/verify?token=secret',
      expiresAt: new Date('2026-08-29T00:10:00Z'),
      idempotencyKey: 'hashed-token',
    });
    expect(captured?.url).toBe('http://mailpit:8025/api/v1/send');
    expect(captured?.body).toMatchObject({
      from: { name: 'VibeLog', email: 'login@send.example.com' },
      to: [{ email: 'writer@example.com' }],
      reply_to: [{ email: 'support@example.com' }],
      subject: 'Your VibeLog sign-in link',
      headers: { 'X-VibeLog-Idempotency-Key': 'hashed-token' },
    });
    expect(captured?.body.html).toContain('10 minutes');
    expect(captured?.body.text).toContain('If you did not request');
  });

  it('classifies non-success and malformed responses as delivery failures', async () => {
    const sender = new MailpitTransactionalEmailSender('http://mailpit:8025', 'sender@example.com', 'support@example.com');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('no', { status: 503 }))));
    await expect(sender.sendMagicLink({ to: 'writer@example.com', url: 'http://app.localtest.me/link', expiresAt: new Date(), idempotencyKey: 'one' }))
      .rejects.toThrow('status 503');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({}))));
    await expect(sender.sendMagicLink({ to: 'writer@example.com', url: 'http://app.localtest.me/link', expiresAt: new Date(), idempotencyKey: 'two' }))
      .rejects.toThrow('invalid response');
  });
});
