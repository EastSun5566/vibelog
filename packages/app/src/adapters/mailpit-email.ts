import type { TransactionalEmailSender } from '../ports/transactional-email.js';
import { magicLinkEmail } from './magic-link-email.js';

interface MailpitAddress { email: string; name?: string }

function parseAddress(value: string): MailpitAddress {
  const match = /^(.*?)\s*<([^<>]+)>$/u.exec(value.trim());
  return match ? { name: match[1]?.trim(), email: match[2]?.trim() ?? '' } : { email: value.trim() };
}

export class MailpitTransactionalEmailSender implements TransactionalEmailSender {
  constructor(private readonly apiUrl: string, private readonly from: string, private readonly replyTo: string) {}

  async sendMagicLink(input: { to: string; url: string; expiresAt: Date; idempotencyKey: string }): Promise<void> {
    const response = await fetch(new URL('/api/v1/send', this.apiUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: parseAddress(this.from),
        to: [parseAddress(input.to)],
        reply_to: [parseAddress(this.replyTo)],
        ...magicLinkEmail(input),
        headers: { 'X-VibeLog-Idempotency-Key': input.idempotencyKey },
      }),
    });
    if (!response.ok) throw new Error(`Local transactional email rejected with status ${String(response.status)}`);
    const result = await response.json() as { id?: unknown; ID?: unknown };
    const id = result.id ?? result.ID;
    if (typeof id !== 'string' || id.length === 0) throw new Error('Local transactional email returned an invalid response');
  }
}
