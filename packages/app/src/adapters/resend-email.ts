import { Resend } from 'resend';
import type { TransactionalEmailSender } from '../ports/transactional-email.js';
import { magicLinkEmail } from './magic-link-email.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 2000] as const;
type Delay = (milliseconds: number) => Promise<void>;

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableFailure(error: { name: string; statusCode: number | null }): boolean {
  return error.name === 'application_error' && error.statusCode === null
    || error.statusCode === 429
    || (error.statusCode !== null && error.statusCode >= 500);
}

export class ResendTransactionalEmailSender implements TransactionalEmailSender {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string, private readonly replyTo: string, baseUrl?: string, private readonly delay: Delay = defaultDelay) { this.client = new Resend(apiKey, { baseUrl }); }
  async sendMagicLink(input: { to: string; url: string; expiresAt: Date; idempotencyKey: string }): Promise<void> {
    const content = magicLinkEmail(input);
    const payload = { from: this.from, to: input.to, replyTo: this.replyTo, ...content };
    let lastFailure: Error | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const { error } = await this.client.emails.send(payload, { idempotencyKey: input.idempotencyKey });
        if (!error) return;
        lastFailure = new Error(`Transactional email rejected: ${error.message}`);
        if (!retryableFailure(error)) throw lastFailure;
      } catch (error) {
        if (lastFailure === error) throw error;
        lastFailure = error instanceof Error ? error : new Error('Transactional email request failed');
      }
      if (attempt === MAX_ATTEMPTS - 1) break;
      await this.delay(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1) ?? 1000);
    }
    throw lastFailure ?? new Error('Transactional email request failed');
  }
}
