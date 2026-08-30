export interface TransactionalEmailSender {
  sendMagicLink(input: { to: string; url: string; expiresAt: Date; idempotencyKey: string }): Promise<void>;
}
