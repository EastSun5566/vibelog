export interface MagicLinkEmailContent { subject: string; text: string; html: string }

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function magicLinkEmail(input: { url: string; expiresAt: Date }): MagicLinkEmailContent {
  const expires = input.expiresAt.toISOString();
  return {
    subject: 'Your VibeLog sign-in link',
    text: `Sign in to VibeLog\n\nOpen this link within 10 minutes:\n${input.url}\n\nExpires: ${expires}\nIf you did not request this email, you can ignore it.`,
    html: `<h1>Sign in to VibeLog</h1><p><a href="${escapeHtml(input.url)}">Open VibeLog</a></p><p>This link expires in 10 minutes (${escapeHtml(expires)}).</p><p>If you did not request this email, you can ignore it.</p>`,
  };
}
