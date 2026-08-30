import { Resend } from 'resend';
import type { TransactionalEmailSender } from '../ports/transactional-email.js';
import { magicLinkEmail } from './magic-link-email.js';

export class ResendTransactionalEmailSender implements TransactionalEmailSender {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string, private readonly replyTo: string, baseUrl?: string) { this.client = new Resend(apiKey, { baseUrl }); }
  async sendMagicLink(input: { to: string; url: string; expiresAt: Date; idempotencyKey: string }): Promise<void> {
    const content = magicLinkEmail(input);
    const { error } = await this.client.emails.send({ from: this.from, to: input.to, replyTo: this.replyTo, ...content }, { idempotencyKey: input.idempotencyKey });
    if (error) throw new Error(`Transactional email rejected: ${error.message}`);
  }
}
