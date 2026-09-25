import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

interface MailpitMessageSummary { id?: string; ID?: string }
interface MailpitMessage { text?: string; Text?: string }

async function requestMagicLink(page: Page, request: APIRequestContext, mailpitUrl: string, email: string): Promise<string> {
  await page.goto('/auth/login');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByLabel('Email')).toHaveCSS('font-size', '16px');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page).toHaveURL(/\/auth\/login\?sent=1$/u);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('We sent a one-time sign-in link. It expires in 10 minutes.');
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
  await expect.poll(() => iframe.getAttribute('src'), { timeout: 180_000 }).not.toBe(before);
  await expectNoPageReload(page);
}

async function expectPreviewPath(page: Page, path: string): Promise<void> {
  await expect.poll(() => page.frames().find((frame) => frame.url().includes('preview.'))?.url(), { timeout: 30_000 }).toContain(path);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function openDisclosure(page: Page, key: string): Promise<void> {
  const details = page.locator(`details[data-disclosure-key="${key}"]`);
  if (!await details.evaluate((node) => (node as HTMLDetailsElement).open)) await details.locator(':scope > summary').click();
}

test('publishes a fixture HackMD blog through the complete local stack', async ({ page, request }) => {
  test.setTimeout(480_000);
  const browserErrors: string[] = [];
  const searchErrors: string[] = [];
  let analyticsScriptRequests = 0;
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Pagefind|WebAssembly|Content Security Policy/iu.test(message.text())) searchErrors.push(message.text());
  });
  await page.route('https://www.googletagmanager.com/gtag/js**', async (route) => {
    analyticsScriptRequests += 1;
    await route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  const mailpitUrl = process.env.E2E_MAILPIT_URL;
  if (!mailpitUrl) throw new Error('E2E_MAILPIT_URL is required');

  const clientResponse = await request.get('/assets/client.js');
  expect(clientResponse.ok()).toBe(true);
  expect(clientResponse.headers()['content-type']).toContain('text/javascript');
  const analyticsResponse = await request.get('/assets/analytics.js');
  expect(analyticsResponse.ok()).toBe(true);
  expect(analyticsResponse.headers()['content-type']).toContain('text/javascript');
  const logoResponse = await request.get('/assets/logo.svg');
  expect(logoResponse.ok()).toBe(true);
  expect(logoResponse.headers()['content-type']).toContain('image/svg+xml');

  const landingResponse = await page.goto('/');
  expect(landingResponse?.headers()['content-security-policy']).toContain("script-src 'nonce-");
  expect(landingResponse?.headers()['content-security-policy']).toContain("'strict-dynamic'");
  expect(landingResponse?.headers()['content-security-policy']).toContain('https://*.google-analytics.com');
  await expect(page.getByRole('heading', { name: /Keep writing in HackMD/ })).toBeVisible();
  await expect(page.locator('.app-brand img')).toHaveAttribute('src', '/assets/logo.svg');
  await expect(page.getByRole('link', { name: 'Start publishing' })).toHaveCount(1);
  const sourceLink = page.getByRole('link', { name: 'VibeLog source code on GitHub' });
  await expect(sourceLink).toHaveAttribute('href', 'https://github.com/EastSun5566/vibelog');
  await expect(sourceLink).toHaveAttribute('target', '_blank');
  await expect(sourceLink).toHaveAttribute('rel', 'noreferrer');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 720 });
  const analyticsConsent = page.getByRole('region', { name: 'Allow analytics?' });
  await expect(analyticsConsent).toBeVisible();
  expect(analyticsScriptRequests).toBe(0);
  await analyticsConsent.getByRole('button', { name: 'Not now' }).click();
  await expect(analyticsConsent).toBeHidden();
  expect(analyticsScriptRequests).toBe(0);
  await page.getByRole('button', { name: 'Analytics settings' }).click();
  await analyticsConsent.getByRole('button', { name: 'Allow analytics' }).click();
  await expect.poll(() => analyticsScriptRequests).toBe(1);
  await expect(analyticsConsent).toBeHidden();
  await page.goto('/guide');
  await expect.poll(() => analyticsScriptRequests).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText('Generate a design with AI or fine-tune it, then publish when the draft is ready.')).toBeVisible();
  await expect(page.getByText('AI cannot write arbitrary CSS or HTML')).toHaveCount(0);
  await expect(page.getByText('VibeLog stores no passwords')).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });

  const magicLink = await requestMagicLink(page, request, mailpitUrl, 'writer@example.com');
  const analyticsRequestsBeforeSignIn = analyticsScriptRequests;
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/onboarding$/u);
  await expect(page.locator('[data-analytics-loader]')).toHaveCount(0);
  expect(analyticsScriptRequests).toBe(analyticsRequestsBeforeSignIn);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByLabel('Blog address')).toHaveCSS('font-size', '16px');
  await page.setViewportSize({ width: 1280, height: 720 });
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
  await expect(page.getByRole('heading', { name: 'Design', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Publish', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '@alice-hackmd on HackMD' })).toHaveAttribute('href', 'https://hackmd.io/@alice-hackmd');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByLabel('Describe the reading experience')).toHaveCSS('font-size', '16px');
  await page.setViewportSize({ width: 1280, height: 720 });
  const appUrl = new URL(page.url());
  const publicSiteUrl = `${appUrl.protocol}//alice.${appUrl.host}`;
  const publishDestination = page.locator('#publish .publish-destination');
  await expect(publishDestination).toHaveText(`Will publish at ${publicSiteUrl}`);
  await expect(publishDestination.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download site ZIP' })).toHaveCount(0);
  const iframe = page.locator('iframe[data-preview-url]');
  const previewUrl = new URL(await iframe.getAttribute('src') ?? '');
  expect(previewUrl.hostname).toBe(`preview.${appUrl.hostname}`);
  const preview = page.frameLocator('iframe[data-preview-url]');
  await expect(preview.getByRole('heading', { name: "Alice Writer's blog", level: 1 })).toBeVisible({ timeout: 30_000 });
  await preview.getByRole('link', { name: 'Hello VibeLog' }).click();
  await expectPreviewPath(page, '/blog/hello-vibelog/');
  await preview.getByRole('link', { name: 'Search' }).click();
  await expectPreviewPath(page, '/search');
  await preview.locator('pagefind-input input').fill('complete local publishing path');
  await expect(preview.locator('pagefind-results a[href="/blog/hello-vibelog/"]')).toBeVisible({ timeout: 30_000 });
  await preview.locator('pagefind-results a[href="/blog/hello-vibelog/"]').click();
  await expectPreviewPath(page, '/blog/hello-vibelog/');
  await expect(page.locator('[data-preview-path-input]').first()).toHaveValue('/blog/hello-vibelog/');
  await markPage(page);

  await page.getByRole('button', { name: 'A restrained independent magazine' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Describe the reading experience')).toHaveValue('A restrained independent magazine');
  await expect(page.getByLabel('Describe the reading experience')).toBeFocused();
  await expect(page.getByLabel('Describe the reading experience')).toHaveAttribute('required', '');
  await expect(page.getByLabel('Describe the reading experience')).toHaveAttribute('minlength', '1');
  await expect(page.getByRole('button', { name: 'Generate with AI' })).toHaveAttribute('aria-keyshortcuts', 'Meta+Enter Control+Enter');
  await expect(page.getByText('⌘/Ctrl + Enter')).toBeVisible();

  let aiPolls = 0;
  await page.route('**/actions/design/generate', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ pollUrl: '/api/operations/mock-ai', successUrl: '/editor' }) }));
  await page.route('**/api/operations/mock-ai', (route) => {
    aiPolls += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(aiPolls === 1
      ? { status: 'running', message: 'AI is shaping your design…', progress: { kind: 'indeterminate' } }
      : { status: 'succeeded', message: 'New design ready', progress: { kind: 'indeterminate' } }) });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const aiBefore = await iframe.getAttribute('src');
  await page.evaluate(() => {
    const status = document.querySelector('.studio-primary [data-feedback-slot="ai"] [data-operation-status]');
    if (!status) throw new Error('AI feedback status is missing');
    new MutationObserver(() => {
      if (status.textContent === 'New design ready') document.documentElement.dataset.aiSuccessFeedback = 'ai';
    }).observe(status, { childList: true, characterData: true, subtree: true });
  });
  await page.getByLabel('Describe the reading experience').press('Control+Enter');
  const aiFeedback = page.locator('.studio-primary [data-feedback-slot="ai"]');
  await expect(aiFeedback.getByText('AI is shaping your design…')).toBeVisible();
  await expect(aiFeedback.locator('[data-operation-progress]')).toBeHidden();
  await expect(aiFeedback.locator('.operation-indicator')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('details[data-disclosure-key="fine-tune"] [data-feedback-slot="ai"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-ai-success-feedback', 'ai');
  await expect.poll(() => iframe.getAttribute('src'), { timeout: 30_000 }).not.toBe(aiBefore);
  await expectNoPageReload(page);
  await expectPreviewPath(page, '/blog/hello-vibelog/');
  await page.unroute('**/actions/design/generate');
  await page.unroute('**/api/operations/mock-ai');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.route('**/actions/design/generate', (route) => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ pollUrl: '/api/operations/mock-ai-failed', successUrl: '/editor' }) }));
  await page.route('**/api/operations/mock-ai-failed', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'failed', message: 'AI service is temporarily unavailable', progress: { kind: 'indeterminate' } }) }));
  await page.getByLabel('Describe the reading experience').fill('A quiet reading room');
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  await expect(page.locator('.studio-primary [data-feedback-slot="ai"]')).toContainText('AI service is temporarily unavailable');
  await expect(page.locator('[data-feedback-slot="fine-tune"]')).not.toContainText('AI service is temporarily unavailable');
  await expectNoPageReload(page);
  await page.unroute('**/actions/design/generate');
  await page.unroute('**/api/operations/mock-ai-failed');

  await page.locator('details[data-disclosure-key="fine-tune"] > summary').click();
  await page.locator('input[name="bodyFont"][value="system-serif"]').check();
  await page.getByLabel('Describe the reading experience').fill('Keep the saved design simple');
  await page.getByRole('button', { name: 'Generate with AI' }).click();
  await expect(page.locator('.studio-primary [data-feedback-slot="ai"]')).toContainText('Save your Fine-tune changes before generating with AI.');
  await expectNoPageReload(page);
  await page.locator('input[name="bodyFont"][value="system-sans"]').check();

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
  await openDisclosure(page, 'advanced-styles');
  const articleStyle = page.locator('fieldset.style-rule-controls').filter({ hasText: 'Article body' });
  await expect(articleStyle.getByLabel('Spacing')).toHaveCount(1);
  await expect(articleStyle.getByLabel('Frame')).toHaveCount(1);
  const footerStyle = page.locator('fieldset.style-rule-controls').filter({ hasText: 'Site footer' });
  await expect(footerStyle.getByLabel('Frame')).toHaveCount(1);
  await expect(footerStyle.getByLabel('Surface')).toHaveCount(1);
  await page.getByRole('group', { name: 'Layout preset' }).getByLabel('Editorial').check();
  await page.getByRole('group', { name: 'Body font' }).getByLabel('Mono').check();
  const fineTuneFeedback = page.locator('details[data-disclosure-key="fine-tune"] [data-feedback-slot="fine-tune"]');
  await expect(fineTuneFeedback).toContainText('Visual preview updated; changes are not saved');
  const fineTuneFeedbackBox = await fineTuneFeedback.boundingBox();
  const saveThemeButtonBox = await page.getByRole('button', { name: 'Save design version' }).boundingBox();
  expect(Math.abs((fineTuneFeedbackBox?.x ?? 0) - (saveThemeButtonBox?.x ?? 0))).toBeLessThanOrEqual(1);
  let structuralPreviewRequests = 0;
  await page.route('**/api/design/preview', (route) => {
    structuralPreviewRequests += 1;
    return route.continue();
  });
  await page.getByRole('group', { name: 'Header' }).getByLabel('Masthead').check();
  await expect(fineTuneFeedback).toContainText('Layout changes will appear after you build this design version.');
  await page.waitForTimeout(400);
  expect(structuralPreviewRequests).toBe(0);
  await page.unroute('**/api/design/preview');
  await page.route('**/actions/design/apply', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Could not save the design' } }) }));
  await page.getByRole('button', { name: 'Save design version' }).click();
  await expect(fineTuneFeedback).toContainText('Could not save the design');
  await expect(page.locator('.studio-primary [data-feedback-slot="ai"]')).not.toContainText('Could not save the design');
  await page.unroute('**/actions/design/apply');
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Save design version' }));
  await expectPreviewPath(page, '/blog/hello-vibelog/');

  await openDisclosure(page, 'design-history');
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
  await expect(page.getByRole('link', { name: 'View live site' })).toHaveAttribute('href', publicSiteUrl);
  const inlineLiveLink = page.locator('#publish .publish-destination a');
  await expect(inlineLiveLink).toHaveText(publicSiteUrl);
  await expect(inlineLiveLink).toHaveAttribute('href', publicSiteUrl);
  await expect(inlineLiveLink).toHaveAttribute('target', '_blank');
  await expect(inlineLiveLink).toHaveAttribute('rel', 'noreferrer');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download site ZIP' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('alice-vibelog.zip');
  const downloadStream = await download.createReadStream();
  const chunks: Uint8Array[] = [];
  for await (const chunk of downloadStream) {
    if (!(chunk instanceof Uint8Array)) throw new Error('ZIP download returned a non-binary chunk');
    chunks.push(chunk);
  }
  const exportedZip = Buffer.concat(chunks);
  expect([...exportedZip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  for (const path of ['index.html', 'design.css', 'blog/hello-vibelog/index.html', 'llms.txt', 'pagefind/pagefind-component-ui.js']) {
    expect(exportedZip.includes(Buffer.from(path))).toBe(true);
  }
  await expectNoPageReload(page);

  await openDisclosure(page, 'fine-tune');
  await page.getByLabel('Notebook').check();
  await expect(page.getByText('Visual preview updated; changes are not saved')).toBeVisible();
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Save design version' }));
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Publish changes' }));
  await openDisclosure(page, 'release-history');
  const restoreLive = page.getByRole('button', { name: 'Restore live' }).first();
  const releaseIndex = await restoreLive.locator('xpath=../..').evaluate((row) => Array.from(row.parentElement?.children ?? []).indexOf(row));
  await restoreLive.click();
  await expect(page.locator('details[data-disclosure-key="release-history"] .revision').nth(releaseIndex).getByText('Live now')).toBeVisible();
  await expectNoPageReload(page);

  const publicUrl = new URL(page.url());
  publicUrl.hostname = `alice.${publicUrl.hostname}`;
  publicUrl.pathname = '/';
  const publicBlogResponse = await page.goto(publicUrl.toString());
  expect(publicBlogResponse?.headers()['content-security-policy']).toContain("script-src 'none'");
  await expect(page.locator('.site-header nav')).toHaveCSS('display', 'flex');
  await expect(page.locator('[data-analytics-loader]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('heading', { name: "Alice's updated blog", level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hello VibeLog' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'A Second Note' })).toHaveCount(0);
  const footerNavigation = page.getByRole('navigation', { name: 'Other ways to read' });
  await expect(footerNavigation.getByRole('link', { name: 'RSS' })).toHaveAttribute('href', '/rss.xml');
  await expect(footerNavigation.getByRole('link', { name: 'llms.txt' })).toHaveAttribute('href', '/llms.txt');
  await page.getByRole('link', { name: 'Hello VibeLog' }).click();
  await expect(page).toHaveURL(/\/blog\/hello-vibelog\/$/u);
  const highlightedCode = page.locator('pre.astro-code');
  await expect(highlightedCode).toHaveCount(1);
  await expect(highlightedCode).not.toHaveAttribute('style');
  await expect(highlightedCode.locator('code span[style]')).toHaveCount(0);
  await expect.poll(async () => {
    const tokenColors = await highlightedCode.locator('code span[class*="syntax-style-"]')
      .evaluateAll((tokens) => tokens.map((token) => getComputedStyle(token).color));
    return new Set(tokenColors).size;
  }, { timeout: 30_000 }).toBeGreaterThan(1);
  const syntaxResponse = await request.get(`${publicUrl.origin}/syntax.css`);
  expect(syntaxResponse.ok()).toBe(true);
  expect(syntaxResponse.headers()['content-type']).toContain('text/css');
  const articleJsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(articleJsonLd ?? '{}')).toMatchObject({ '@type': 'BlogPosting', headline: 'Hello VibeLog', author: { name: 'Alice Writer' } });
  const markdownResponse = await request.get(`${publicUrl.origin}/blog/hello-vibelog/index.md`);
  expect(markdownResponse.ok()).toBe(true);
  expect(markdownResponse.headers()['content-type']).toContain('text/markdown');
  expect(await markdownResponse.text()).toContain('This article came through the complete local publishing path.');
  const llmsResponse = await request.get(`${publicUrl.origin}/llms.txt`);
  expect(llmsResponse.ok()).toBe(true);
  expect(llmsResponse.headers()['content-type']).toContain('text/plain');
  expect(await llmsResponse.text()).toContain(`${publicUrl.origin}/blog/hello-vibelog/index.md`);
  const robotsResponse = await request.get(`${publicUrl.origin}/robots.txt`);
  expect(robotsResponse.ok()).toBe(true);
  expect(robotsResponse.headers()['content-type']).toContain('text/plain');
  expect(await robotsResponse.text()).toContain(`Sitemap: ${publicUrl.origin}/sitemap-index.xml`);
  const pagefindScript = await request.get(`${publicUrl.origin}/pagefind/pagefind-component-ui.js`);
  expect(pagefindScript.ok()).toBe(true);
  expect(pagefindScript.headers()['content-type']).toContain('text/javascript');
  const pagefindWorker = await request.get(`${publicUrl.origin}/pagefind/pagefind-worker.js`);
  expect(pagefindWorker.ok()).toBe(true);
  expect(pagefindWorker.headers()['content-security-policy']).toContain("'wasm-unsafe-eval'");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.goto(`${publicUrl.origin}/search/`);
  expect((await page.request.get(page.url())).headers()['content-security-policy']).toContain("script-src 'self' 'wasm-unsafe-eval'");
  await expectNoHorizontalOverflow(page);
  const searchInput = page.locator('pagefind-input input');
  await expect(searchInput).toHaveCSS('font-size', '16px');
  await searchInput.fill('complete local publishing path');
  const searchResult = page.locator('pagefind-results a[href="/blog/hello-vibelog/"]');
  await expect(searchResult).toBeVisible({ timeout: 30_000 });
  await searchInput.press('ArrowDown');
  await expect(searchResult).toBeFocused();
  await searchResult.press('Enter');
  await expect(page).toHaveURL(/\/blog\/hello-vibelog\/$/u);
  await page.setViewportSize({ width: 1280, height: 720 });

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
  await page.getByLabel('Blog address').fill('alice-zh');
  await page.getByLabel('Blog language').fill('zh-Hant');
  await page.getByRole('button', { name: 'Sync and build preview' }).click();
  await expect(page).toHaveURL(/\/editor(?:\?|$)/u, { timeout: 120_000 });
  await markPage(page);
  const chinesePreview = page.frameLocator('iframe[data-preview-url]');
  await chinesePreview.getByRole('link', { name: '搜尋' }).click();
  await expectPreviewPath(page, '/search');
  await chinesePreview.locator('pagefind-input input').fill('中文搜尋測試');
  await expect(chinesePreview.locator('pagefind-results a[href="/blog/hello-vibelog/"]')).toBeVisible({ timeout: 30_000 });
  await expectPartialRefresh(page, page.getByRole('button', { name: 'Publish first release' }));
  const secondPublicUrl = new URL(appUrl.origin);
  secondPublicUrl.hostname = `alice-zh.${secondPublicUrl.hostname}`;
  expect((await request.get(secondPublicUrl.toString())).ok()).toBe(true);

  await openDisclosure(page, 'danger-zone');
  const deleteBlogConfirmation = page.getByLabel(/Type alice-zh\..+ to confirm/u);
  await deleteBlogConfirmation.fill('wrong.example.com');
  await page.getByRole('button', { name: 'Delete blog' }).click();
  await expect(page.getByText('Confirmation did not match. Nothing was deleted.')).toBeVisible();
  await openDisclosure(page, 'danger-zone');
  await page.getByLabel(/Type alice-zh\..+ to confirm/u).fill(`alice-zh.${appUrl.hostname}`);
  await page.getByRole('button', { name: 'Delete blog' }).click();
  await expect(page).toHaveURL(/\/onboarding\?deleted=1$/u);
  await expect(page.getByText('Your previous blog was deleted.')).toBeVisible();
  expect((await request.get(secondPublicUrl.toString())).status()).toBe(404);

  await openDisclosure(page, 'danger-zone');
  await page.getByLabel('Type second-writer@example.com to confirm').fill('second-writer@example.com');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/auth\/login\?deleted=1$/u);
  await expect(page.getByText('Your VibeLog account was deleted.')).toBeVisible();
  expect(browserErrors).toEqual([]);
  expect(searchErrors).toEqual([]);
});
