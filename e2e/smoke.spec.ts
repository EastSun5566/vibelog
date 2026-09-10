import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

interface MailpitMessageSummary { id?: string; ID?: string }
interface MailpitMessage { text?: string; Text?: string }

async function requestMagicLink(page: Page, request: APIRequestContext, mailpitUrl: string, email: string): Promise<string> {
  await page.goto('/auth/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page).toHaveURL(/\/auth\/login\?sent=1$/u);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Use a different email' })).toBeVisible();

  let messageId: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(`${mailpitUrl}/api/v1/messages?start=0&limit=10`);
    if (!response.ok()) return undefined;
    const body = await response.json() as { messages?: MailpitMessageSummary[]; Messages?: MailpitMessageSummary[] };
    const message = (body.messages ?? body.Messages ?? [])[0];
    messageId = message?.id ?? message?.ID;
    return messageId;
  }).toBeTruthy();

  const response = await request.get(`${mailpitUrl}/api/v1/message/${encodeURIComponent(messageId ?? '')}`);
  expect(response.ok()).toBe(true);
  const message = await response.json() as MailpitMessage;
  const magicLink = /https?:\/\/[^\s<"]+\/api\/auth\/magic-link\/verify[^\s<"]*/u.exec(message.text ?? message.Text ?? '')?.[0];
  expect(magicLink).toBeTruthy();
  return magicLink ?? '';
}

async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => { (window as typeof window & { __vibelogSentinel?: string }).__vibelogSentinel = 'stable'; });
}

async function expectNoPageReload(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __vibelogSentinel?: string }).__vibelogSentinel)).toBe('stable');
}

async function expectPartialRefresh(page: Page, trigger: Locator): Promise<void> {
  const iframe = page.locator('iframe[data-preview-url]');
  const before = await iframe.getAttribute('src');
  await trigger.click();
  await expect.poll(() => iframe.getAttribute('src'), { timeout: 120_000 }).not.toBe(before);
  await expectNoPageReload(page);
}

async function expectPreviewPath(page: Page, path: string): Promise<void> {
  await expect.poll(() => page.frames().find((frame) => frame.url().includes('preview.'))?.url(), { timeout: 30_000 }).toContain(path);
}

async function openDisclosure(page: Page, key: string): Promise<void> {
  const details = page.locator(`details[data-disclosure-key="${key}"]`);
  if (!await details.evaluate((node) => (node as HTMLDetailsElement).open)) await details.locator('summary').click();
}

test('publishes a fixture HackMD blog through the complete local stack', async ({ page, request }) => {
  test.setTimeout(300_000);
  const mailpitUrl = process.env.E2E_MAILPIT_URL;
  if (!mailpitUrl) throw new Error('E2E_MAILPIT_URL is required');

  const logoResponse = await request.get('/assets/logo.svg');
  expect(logoResponse.ok()).toBe(true);
  expect(logoResponse.headers()['content-type']).toContain('image/svg+xml');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Keep writing in HackMD/ })).toBeVisible();
  await expect(page.locator('.app-brand img')).toHaveAttribute('src', '/assets/logo.svg');
  await expect(page.getByRole('link', { name: 'Start publishing' })).toHaveCount(1);

  const magicLink = await requestMagicLink(page, request, mailpitUrl, 'writer@example.com');
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/onboarding$/u);
  await page.getByLabel('Blog address').fill('alice');
  await expect(page.locator('[data-blog-hostname]')).toHaveText(/alice\./u);
  const profile = page.locator('[data-hackmd-profile]');
  await expect(profile).toHaveAttribute('aria-disabled', 'true');
  await page.getByLabel('HackMD username').fill('alice-hackmd');
  await expect(profile).toHaveText('https://hackmd.io/@alice-hackmd');
  await expect(profile).toHaveAttribute('href', 'https://hackmd.io/@alice-hackmd');
  await expect(page.locator('#language-suggestions option')).toHaveCount(12);
  await page.getByLabel('Blog language').fill('en-US');
  await page.getByRole('button', { name: 'Sync and build preview' }).click();

  await expect(page).toHaveURL(/\/editor(?:\?|$)/u, { timeout: 120_000 });
  await expect(page.getByRole('heading', { name: "Alice Writer's blog" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Publish', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '@alice-hackmd on HackMD' })).toHaveAttribute('href', 'https://hackmd.io/@alice-hackmd');
  const appUrl = new URL(page.url());
  const iframe = page.locator('iframe[data-preview-url]');
  const previewUrl = new URL(await iframe.getAttribute('src') ?? '');
  expect(previewUrl.hostname).toBe(`preview.${appUrl.hostname}`);
  const preview = page.frameLocator('iframe[data-preview-url]');
  await expect(preview.getByRole('heading', { name: "Alice Writer's blog", level: 1 })).toBeVisible({ timeout: 30_000 });
  await preview.getByRole('link', { name: 'Hello VibeLog' }).click();
  await expectPreviewPath(page, '/blog/hello-vibelog/');
  await markPage(page);

  await page.getByRole('button', { name: 'A restrained independent magazine' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Describe the reading experience')).toHaveValue('A restrained independent magazine');
  await expect(page.getByLabel('Describe the reading experience')).toBeFocused();

  let aiPolls = 0;
  await page.route('**/actions/theme/generate', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ pollUrl: '/api/operations/mock-ai', successUrl: '/editor' }) }));
  await page.route('**/api/operations/mock-ai', (route) => {
    aiPolls += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(aiPolls === 1
      ? { status: 'running', message: 'AI is designing a new theme…', progress: { kind: 'indeterminate' } }
      : { status: 'succeeded', message: 'Theme ready', progress: { kind: 'indeterminate' } }) });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const aiBefore = await iframe.getAttribute('src');
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  await expect(page.getByText('AI is designing a new theme…')).toBeVisible();
  await expect(page.locator('[data-state="running"] [data-operation-progress]')).toBeHidden();
  await expect(page.locator('[data-state="running"] .operation-indicator')).toHaveCSS('animation-name', 'none');
  await expect.poll(() => iframe.getAttribute('src'), { timeout: 30_000 }).not.toBe(aiBefore);
  await expectNoPageReload(page);
  await expectPreviewPath(page, '/blog/hello-vibelog/');
  await page.unroute('**/actions/theme/generate');
  await page.unroute('**/api/operations/mock-ai');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  let syncPolls = 0;
  await page.route('**/actions/blog/sync', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ pollUrl: '/api/operations/mock-sync', successUrl: '/editor' }) }));
  await page.route('**/api/operations/mock-sync', (route) => {
    syncPolls += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(syncPolls === 1
      ? { status: 'running', message: 'Building static preview', progress: { kind: 'determinate', value: 2, max: 4 } }
      : { status: 'succeeded', message: 'Content synced', progress: { kind: 'determinate', value: 4, max: 4 } }) });
  });
  const syncBefore = await iframe.getAttribute('src');
  await page.getByRole('button', { name: 'Sync now' }).click();
  const progress = page.locator('[data-operation-progress]:visible');
  await expect(progress).toHaveAttribute('value', '2');
  await expect(progress).toHaveAttribute('max', '4');
  await expect.poll(() => iframe.getAttribute('src'), { timeout: 30_000 }).not.toBe(syncBefore);
  await expectNoPageReload(page);
  await page.unroute('**/actions/blog/sync');
  await page.unroute('**/api/operations/mock-sync');

  await page.route('**/actions/blog/sync', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ pollUrl: '/api/operations/mock-failed', successUrl: '/editor' }) }));
  await page.route('**/api/operations/mock-failed', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'failed', message: 'HackMD is unavailable', progress: { kind: 'indeterminate' } }) }));
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('HackMD is unavailable')).toBeFocused();
  await expect(page.locator('[data-state="failed"]')).toBeVisible();
  await expectNoPageReload(page);
  await page.unroute('**/actions/blog/sync');
  await page.unroute('**/api/operations/mock-failed');

  await openDisclosure(page, 'fine-tune');
  await page.getByLabel('Editorial').check();
  await expect(page.getByText('Preview updated; changes are not saved')).toBeVisible();
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Save theme version' }));
  await expectPreviewPath(page, '/blog/hello-vibelog/');

  await openDisclosure(page, 'theme-history');
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Preview version' }).first());
  await expectPreviewPath(page, '/blog/hello-vibelog/');

  await openDisclosure(page, 'blog-details');
  await page.getByLabel('Blog title').fill("Alice's updated blog");
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Save blog details' }));
  await expect(page.getByRole('heading', { name: "Alice's updated blog" })).toBeVisible();
  await expectPreviewPath(page, '/blog/hello-vibelog/');

  await openDisclosure(page, 'articles');
  await page.getByLabel('A Second Note').uncheck();
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Save article selection' }));
  await expect(page.getByText('1 of 2 included')).toBeVisible();
  await expectPreviewPath(page, '/blog/hello-vibelog/');

  await page.setViewportSize({ width: 390, height: 844 });
  const previewBox = await page.locator('.preview-panel').boundingBox();
  const controlsBox = await page.locator('.controls').boundingBox();
  expect(previewBox?.y).toBeLessThan(controlsBox?.y ?? 0);
  await page.setViewportSize({ width: 1280, height: 720 });

  await expectPartialRefresh(page, page.getByRole('button', { name: 'Publish first release' }));
  await expect(page.getByText('Live version is current')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View live site' })).toHaveAttribute('href', `${appUrl.protocol}//alice.${appUrl.host}`);

  await openDisclosure(page, 'fine-tune');
  await page.getByLabel('Notebook').check();
  await expect(page.getByText('Preview updated; changes are not saved')).toBeVisible();
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Save theme version' }));
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Publish changes' }));
  await openDisclosure(page, 'release-history');
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Restore live' }).first());

  const publicUrl = new URL(page.url());
  publicUrl.hostname = `alice.${publicUrl.hostname}`;
  publicUrl.pathname = '/';
  await page.goto(publicUrl.toString());
  await expect(page.getByRole('heading', { name: "Alice's updated blog", level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hello VibeLog' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'A Second Note' })).toHaveCount(0);

  await page.goto(`${appUrl.origin}/editor`);
  await page.getByRole('button', { name: 'Sign out' }).click();
  const secondMagicLink = await requestMagicLink(page, request, mailpitUrl, 'second-writer@example.com');
  await page.goto(secondMagicLink);
  await page.getByLabel('Blog address').fill('alice');
  await page.getByLabel('HackMD username').fill('alice-hackmd');
  await page.getByRole('button', { name: 'Sync and build preview' }).click();
  await expect(page.locator('[data-blog-address-error]')).toHaveText('That blog address is already taken. Choose another one.');
  await expect(page.getByLabel('Blog address')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/onboarding$/u);
});
