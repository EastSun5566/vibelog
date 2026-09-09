import { expect, test } from '@playwright/test';

interface MailpitMessageSummary { id?: string; ID?: string }
interface MailpitMessage { text?: string; Text?: string }

test('publishes a fixture HackMD blog through the complete local stack', async ({ page, request }) => {
  const mailpitUrl = process.env.E2E_MAILPIT_URL;
  if (!mailpitUrl) throw new Error('E2E_MAILPIT_URL is required');

  const logoResponse = await request.get('/assets/logo.svg');
  expect(logoResponse.ok()).toBe(true);
  expect(logoResponse.headers()['content-type']).toContain('image/svg+xml');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Keep writing in HackMD/ })).toBeVisible();
  await expect(page.locator('.app-brand img')).toHaveAttribute('src', '/assets/logo.svg');
  await expect(page.getByRole('link', { name: 'Start publishing' })).toHaveCount(1);
  await page.getByRole('link', { name: 'Start publishing' }).click();
  await expect(page.getByText('We’ll email you a one-time sign-in link.')).toBeVisible();
  await page.getByLabel('Email').fill('writer@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your email.')).toBeVisible();

  let messageId: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(`${mailpitUrl}/api/v1/messages?start=0&limit=10`);
    if (!response.ok()) return undefined;
    const body = await response.json() as { messages?: MailpitMessageSummary[]; Messages?: MailpitMessageSummary[] };
    const message = (body.messages ?? body.Messages ?? [])[0];
    messageId = message?.id ?? message?.ID;
    return messageId;
  }).toBeTruthy();

  const messageResponse = await request.get(`${mailpitUrl}/api/v1/message/${encodeURIComponent(messageId ?? '')}`);
  expect(messageResponse.ok()).toBe(true);
  const message = await messageResponse.json() as MailpitMessage;
  const magicLink = /https?:\/\/[^\s<"]+\/api\/auth\/magic-link\/verify[^\s<"]*/u.exec(message.text ?? message.Text ?? '')?.[0];
  expect(magicLink).toBeTruthy();

  await page.goto(magicLink ?? '');
  await expect(page).toHaveURL(/\/onboarding$/u);
  await page.getByLabel('Blog address').fill('alice');
  await expect(page.locator('[data-blog-hostname]')).toHaveText(/alice\./u);
  await page.getByLabel('HackMD username').fill('alice-hackmd');
  await page.getByLabel('Blog language').fill('en');
  await page.getByRole('button', { name: 'Sync and build preview' }).click();

  await expect(page).toHaveURL(/\/editor(?:\?|$)/u, { timeout: 120_000 });
  await expect(page.getByRole('heading', { name: "Alice Writer's blog" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Publish', exact: true })).toBeVisible();
  const appUrl = new URL(page.url());
  const previewUrl = new URL(await page.locator('iframe[title^="Live preview"]').getAttribute('src') ?? '');
  expect(previewUrl.hostname).toBe(`preview.${appUrl.hostname}`);
  const preview = page.frameLocator('iframe[title^="Live preview"]');
  await expect(preview.getByRole('heading', { name: "Alice Writer's blog", level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByRole('link', { name: 'Hello VibeLog' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const previewBox = await page.locator('.preview-panel').boundingBox();
  const controlsBox = await page.locator('.controls').boundingBox();
  expect(previewBox?.y).toBeLessThan(controlsBox?.y ?? 0);

  await page.getByRole('button', { name: /Publish first release/ }).click();
  await expect(page.getByText('Live version is current')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('link', { name: 'View live site' })).toHaveAttribute('href', `${appUrl.protocol}//alice.${appUrl.host}`);

  const publicUrl = new URL(page.url());
  publicUrl.hostname = `alice.${publicUrl.hostname}`;
  publicUrl.pathname = '/';
  await page.goto(publicUrl.toString());
  await expect(page.getByRole('heading', { name: "Alice Writer's blog", level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hello VibeLog' })).toBeVisible();
});
