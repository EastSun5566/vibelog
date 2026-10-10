import type { BlogDesignSpecV2 } from '@vibelog/core';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CliProcessResult, CliProcessState } from './cli-process.js';

async function runCliProcess(args: string[], state: CliProcessState = { credentials: null, pairing: null }, input?: string): Promise<CliProcessResult> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./cli-process.ts', import.meta.url)), { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('CLI test process timed out.')); }, 40_000);
    let result: CliProcessResult | undefined;
    child.once('error', () => { clearTimeout(timeout); reject(new Error('CLI test process failed.')); });
    child.once('message', (value: CliProcessResult) => { result = value; });
    child.once('exit', (code) => { clearTimeout(timeout); if (code === 0 && result) resolve(result); else reject(new Error('CLI test process failed.')); });
    child.send({ args, state, input });
  });
}

interface MailpitMessageSummary { id?: string; ID?: string }
interface MailpitMessage { text?: string; Text?: string }

async function requestMagicLink(page: Page, request: APIRequestContext, mailpitUrl: string, email: string, returnTo = ''): Promise<string> {
  const login = await page.goto(returnTo ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}` : '/auth/login');
  expect(login?.headers()['cache-control']).toBe('private, no-store');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByLabel('Email')).toHaveCSS('font-size', '16px');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page).toHaveURL(/\/auth\/login\?sent=1(?:&returnTo=.*)?$/u);
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
  await expect(page.getByRole('button', { name: 'Copy agent prompt' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Use the editor' })).toHaveAttribute('href', '/auth/login');
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
  await expect(page.locator('.workflow-heading p')).toHaveCount(0);
  await expect(page.locator('#prompt-help')).toHaveText('Starts from your saved design.');
  await expect(page.getByText('Current draft design', { exact: true })).toHaveCount(0);
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
  expect(publicBlogResponse?.headers()['cache-control']).toBe('public, no-cache');
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
  await expect(page.locator('.prose')).toContainText('Plain prefix:value');
  await expect(page.locator('.prose p code')).toHaveText('a < b');
  await expect(page.locator('pre code').filter({ hasText: '<div>literal code</div>' })).toHaveText('<div>literal code</div>');
  const highlightedCode = page.locator('pre.astro-code').filter({ hasText: 'const greeting = "hello";' });
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

test('agent primary entry supports copy, fallback, keyboard and no JavaScript', async ({ page, browser }, testInfo) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { agentClipboard?: string; agentCopyFails?: boolean };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: (text: string) => { if (state.agentCopyFails) return Promise.reject(new Error('Clipboard denied')); state.agentClipboard = text; return Promise.resolve(); },
    } });
  });
  await page.goto('/');
  const prompt = page.getByLabel('Agent prompt');
  const button = page.getByRole('button', { name: 'Copy agent prompt' });
  const disclosure = page.locator('.agent-prompt-primary details');
  const summary = disclosure.locator('summary');
  await expect(prompt).toBeHidden();
  await expect(button).toBeVisible();
  await expect(disclosure).not.toHaveAttribute('open', '');
  await page.screenshot({ path: testInfo.outputPath('agent-entry-collapsed-desktop.png'), fullPage: true });
  await button.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-agent-copy-status]')).toHaveText('Copied. Paste it into your coding agent.');
  expect(await page.evaluate(() => (window as typeof window & { agentClipboard?: string }).agentClipboard)).toBe(await prompt.inputValue());
  await expect(prompt).toBeHidden();
  await summary.focus(); await page.keyboard.press('Enter'); await expect(prompt).toBeVisible();
  await summary.press('Enter'); await expect(prompt).toBeHidden();
  await page.evaluate(() => { (window as typeof window & { agentCopyFails?: boolean }).agentCopyFails = true; });
  await button.click(); await expect(prompt).toBeFocused();
  await expect(disclosure).toHaveAttribute('open', '');
  await expect(page.locator('[data-agent-copy-status]')).toHaveText('Select and copy the prompt.');
  expect(await prompt.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart)).toBe((await prompt.inputValue()).length);
  await page.reload(); await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await expectNoHorizontalOverflow(page);
  await expect(button).toBeVisible(); await expect(prompt).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('agent-entry-collapsed-mobile.png'), fullPage: true });
  await summary.click(); await expect(prompt).toBeVisible();
  await expect(prompt).toHaveCSS('font-size', '16px');
  await page.screenshot({ path: testInfo.outputPath('agent-entry-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 }); await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('agent-entry-desktop.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; }); await expectNoHorizontalOverflow(page);
  await expect(button).toBeVisible();
  await page.goto('/guide');
  await expect(page.locator('.guide h2')).toHaveText(['Get started', 'Update and publish', 'Design and built-in features']);
  await expectNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 }); await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('guide-mobile.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: testInfo.outputPath('guide-desktop.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; }); await expectNoHorizontalOverflow(page);
  const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL: process.env.E2E_APP_ORIGIN });
  try {
    const native = await noJs.newPage(); await native.goto('/');
    await expect(native.getByLabel('Agent prompt')).toBeHidden();
    const nativeSummary = native.locator('summary').filter({ hasText: 'View prompt' });
    await nativeSummary.focus(); await native.keyboard.press('Enter');
    await expect(native.getByLabel('Agent prompt')).toBeVisible();
    await expect(native.getByLabel('Agent prompt')).toContainText('@vibelog/cli@0.1.0');
    await native.getByRole('link', { name: 'Use the editor' }).click();
    await expect(native.getByLabel('Email')).toBeVisible();
  } finally { await noJs.close(); }
});

test('agent draft access supports human publish and explicit publishing upgrade', async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const origin = process.env.E2E_APP_ORIGIN;
  const mailpitUrl = process.env.E2E_MAILPIT_URL;
  if (!origin || !mailpitUrl) throw new Error('E2E origins are required');
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const started = await runCliProcess(['login', '--no-wait', '--origin', origin]);
  expect(started.exitCode).toBe(0);
  const approval = started.output[0] as { status: string; authorizationUrl: string; userCode: string };
  expect(approval.status).toBe('approval_required');
  const pairing = approval;
  await page.goto(pairing.authorizationUrl); await expect(page).toHaveURL(/\/auth\/login\?returnTo=/u);
  await expect(page.getByText('Sign in first, then approve your agent’s access to your private draft.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('agent-login-mobile.png'), fullPage: true });
  const returnTo = `/agent/authorize?code=${pairing.userCode}`;
  const email = `agent-${String(Date.now())}@example.com`;
  const wrongEmail = `other-${email}`;
  const link = await requestMagicLink(page, request, mailpitUrl, wrongEmail, returnTo);
  await expect(page.getByText('Open the link to sign in, then approve your agent’s draft access. You can close this tab.')).toBeVisible();
  await page.goto(link); await expect(page.getByRole('heading', { name: 'Authorize your agent' })).toBeVisible();
  await expect(page.getByText(wrongEmail, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await expect(page).toHaveURL(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const intendedLink = await requestMagicLink(page, request, mailpitUrl, email, returnTo);
  await page.goto(intendedLink);
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  await expect(page).toHaveURL(returnTo);
  await expect(page.getByText(pairing.userCode, { exact: true })).toBeVisible();
  await page.goto(`${returnTo}&done=1`);
  await expect(page.getByRole('heading', { name: 'Authorize your agent' })).toBeVisible();
  const form = page.locator('form[action="/agent/authorize"]');
  const csrf = await form.locator('input[name="csrfToken"]').inputValue();
  await page.setViewportSize({ width: 390, height: 844 }); await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Authorize draft access' }).focus();
  await expect(page.getByRole('button', { name: 'Authorize draft access' })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('agent-authorization-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  expect((await page.request.post('/agent/authorize', { headers: { origin }, form: { code: pairing.userCode, decision: 'approve', csrfToken: 'invalid' }, maxRedirects: 0 })).status()).toBe(403);
  expect((await page.request.post('/auth/logout', { headers: { origin }, form: { csrfToken: 'invalid', returnTo }, maxRedirects: 0 })).status()).toBe(403);
  await form.evaluate((node) => { const input = document.createElement('input'); input.type = 'hidden'; input.name = 'canPublish'; input.value = 'true'; node.append(input); });
  await page.getByRole('button', { name: 'Authorize draft access' }).click();
  await expect(page).toHaveURL(returnTo);
  await expect(page.getByRole('heading', { name: 'Draft access approved' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('agent-approved-desktop.png'), fullPage: true });
  await page.reload(); await expect(page.getByRole('heading', { name: 'Draft access approved' })).toBeVisible();
  // Browser approval can finish before the CLI's persisted first-poll deadline.
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, (started.state.pairing?.nextPollAt ?? 0) - Date.now())));
  const resumed = await runCliProcess(['login', '--no-wait', '--origin', origin], started.state);
  expect(resumed.exitCode).toBe(0); expect(resumed.output).toEqual([expect.objectContaining({ status: 'authorized' })]);
  expect(resumed.state.pairing).toBeNull();
  const credentials = resumed.state.credentials; if (!credentials) throw new Error('Missing test authorization');
  expect(JSON.stringify([...started.output, ...resumed.output])).not.toContain(credentials.token);
  const privateDeviceCode = started.state.pairing?.deviceCode; if (!privateDeviceCode) throw new Error('Missing test pairing');
  expect(JSON.stringify([...started.output, ...resumed.output])).not.toContain(privateDeviceCode);
  const headers = { authorization: `Bearer ${credentials.token}` };
  await page.reload(); await expect(page.getByRole('heading', { name: 'Agent connected' })).toBeVisible();
  const unrelatedPairing = await request.post('/api/agent/v1/pairings', { data: {} });
  const denied = await unrelatedPairing.json() as { authorizationUrl: string; userCode: string };
  await page.goto(denied.authorizationUrl); await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  expect((await request.post('/api/agent/v1/pairings/token', { data: { deviceCode: privateDeviceCode } })).status()).toBe(403);
  expect((await page.request.get('/api/agent/v1/context')).status()).toBe(401);
  expect((await request.post('/actions/publish', { headers, data: {}, maxRedirects: 0 })).status()).toBe(302);
  expect(await (await request.get('/api/agent/v1/context', { headers })).json()).toMatchObject({ blog: null, sourceReady: false, draftReady: false, nextActions: [{ action: 'connect' }] });
  const session = await (await request.get('/api/agent/v1/session', { headers })).json() as { permission: string; expiresAt: string };
  expect(session).toHaveProperty('canPublish', false); expect(session.permission).toBe('draft:read-write'); expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.now());
  const username = `agent-${String(Date.now())}`;
  const key = `connect-${String(Date.now())}-request`;
  const failedSetup = await request.post('/api/agent/v1/connect', { headers: { ...headers, 'Idempotency-Key': `wrong-profile-${String(Date.now())}` }, data: { username: `wrong-${String(Date.now())}`, hackmdUsername: 'missing-public-profile', language: 'en' } });
  expect(failedSetup.status()).toBe(202);
  const failedWork = await failedSetup.json() as { operationId: string };
  await expect.poll(async () => (await (await request.get(`/api/agent/v1/operations/${failedWork.operationId}`, { headers })).json() as { status: string }).status, { timeout: 30_000, intervals: [1000] }).toBe('failed');
  const failedContext = await (await request.get('/api/agent/v1/context', { headers })).json() as { stateVersion: string };
  await page.goto('/onboarding');
  await expect(page.getByLabel('Blog address')).toBeEditable();
  await expect(page.locator('input[name="stateVersion"]')).toHaveValue(failedContext.stateVersion);
  await page.setViewportSize({ width: 390, height: 844 }); await expectNoHorizontalOverflow(page);
  await page.getByLabel('Blog address').focus(); await expect(page.getByLabel('Blog address')).toBeFocused();
  await page.getByLabel('Blog address').fill('alice');
  await page.getByLabel('HackMD username').fill('alice-hackmd');
  await page.getByRole('button', { name: 'Retry sync', exact: true }).click();
  await expect(page.locator('[data-blog-address-error]')).toHaveText('That blog address is already taken. Choose another one.');
  await expect(page.getByLabel('Blog address')).toHaveValue('alice');
  expect(await (await request.get('/api/agent/v1/context', { headers })).json()).toMatchObject({ stateVersion: failedContext.stateVersion, sourceReady: false, draftReady: false, operationId: null });
  await page.setViewportSize({ width: 1280, height: 720 });
  const connect = { username, hackmdUsername: 'alice-hackmd', language: 'en' };
  const recovery = { ...connect, stateVersion: failedContext.stateVersion };
  const result = await request.post('/api/agent/v1/connect', { headers: { ...headers, 'Idempotency-Key': key }, data: recovery });
  expect(result.status()).toBe(202); const accepted = await result.json() as { operationId: string };
  const replay = await request.post('/api/agent/v1/connect', { headers: { ...headers, 'Idempotency-Key': key }, data: recovery });
  expect(await replay.json()).toEqual(accepted);
  await expect.poll(async () => (await (await request.get(`/api/agent/v1/operations/${accepted.operationId}`, { headers })).json() as { status: string }).status, { timeout: 90_000, intervals: [5000] }).toBe('succeeded');
  const context = await (await request.get('/api/agent/v1/context', { headers })).json() as { stateVersion: string; design: BlogDesignSpecV2; editorUrl: string };
  expect(context).toMatchObject({ publication: { status: 'not_published', publicUrl: null }, postCounts: { total: 2, selected: 2 }, sourceReady: true, draftReady: true, operationId: null, nextActions: ['design', 'identity', 'selection', 'sync', 'open_editor'].map((action) => ({ action })) });
  const unchanged = await request.post('/api/agent/v1/connect', { headers: { ...headers, 'Idempotency-Key': `connect-again-${String(Date.now())}` }, data: connect });
  expect(await unchanged.json()).toEqual({ status: 'unchanged' });
  expect(context.editorUrl).toBe(`${origin}/editor`); expect(JSON.stringify(context)).not.toContain('/preview-access/'); expect(JSON.stringify(context)).not.toContain('This article came through');
  const design = { ...context.design, theme: { ...context.design.theme, typography: { ...context.design.theme.typography, bodyFont: 'system-mono' as const } }, description: 'Agent-designed private draft' };
  expect((await request.post('/api/agent/v1/design/validate', { headers, data: { design } })).status()).toBe(200);
  const submit = await request.post('/api/agent/v1/design', { headers: { ...headers, 'Idempotency-Key': `design-${String(Date.now())}-request` }, data: { stateVersion: context.stateVersion, design } });
  expect(submit.status()).toBe(202); const operation = await submit.json() as { operationId: string };
  await expect.poll(async () => (await (await request.get(`/api/agent/v1/operations/${operation.operationId}`, { headers })).json() as { status: string }).status, { timeout: 90_000, intervals: [5000] }).toBe('succeeded');
  expect((await request.post('/api/agent/v1/publish', { headers, data: {} })).status()).toBe(403);
  const publicUrl = new URL(origin); publicUrl.hostname = `${username}.${publicUrl.hostname}`;
  expect((await request.get(publicUrl.href)).status()).toBe(404);
  await page.goto(context.editorUrl); await expect(page.getByText('Agent-designed private draft', { exact: true }).first()).toBeVisible();
  await expect(page.locator('iframe[data-preview-url]')).toBeVisible();
  await expect(page.locator('.controls > details[data-agent-prompt]')).toBeVisible();
  await expect(page.locator('.controls [data-agent-prompt] details')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('agent-editor-desktop.png'), fullPage: true });
  await openDisclosure(page, 'agent');
  await expect(page.getByLabel('Agent prompt')).toContainText('@vibelog/cli@0.1.0');
  await markPage(page); await expectPartialRefresh(page, page.getByRole('button', { name: 'Publish first release' }));
  await expect(page.locator('details[data-disclosure-key="agent"]')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Copy agent prompt' }).click();
  await expect(page.locator('[data-agent-copy-status]')).toHaveText(/Copied\.|Select and copy/u);
  await page.setViewportSize({ width: 390, height: 844 }); await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('agent-editor-mobile.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; }); await expectNoHorizontalOverflow(page);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await page.setViewportSize({ width: 1280, height: 720 });
  expect((await request.get(publicUrl.href)).status()).toBe(200);
  const liveStyleResponse = await request.get(new URL('/design.css', publicUrl).href);
  expect(liveStyleResponse.status()).toBe(200); const liveStyle = await liveStyleResponse.text();
  const current = await (await request.get('/api/agent/v1/context', { headers })).json() as typeof context;
  const revised = { ...current.design, theme: { ...current.design.theme, colors: { ...current.design.theme.colors, accent: '#991b1b' } }, description: 'Updated existing private draft' };
  const update = await request.post('/api/agent/v1/design', { headers: { ...headers, 'Idempotency-Key': `existing-design-${String(Date.now())}` }, data: { stateVersion: current.stateVersion, design: revised } });
  expect(update.status()).toBe(202); const updated = await update.json() as { operationId: string };
  await expect.poll(async () => (await (await request.get(`/api/agent/v1/operations/${updated.operationId}`, { headers })).json() as { status: string }).status, { timeout: 90_000, intervals: [5000] }).toBe('succeeded');
  expect(await (await request.get(new URL('/design.css', publicUrl).href)).text()).toBe(liveStyle);
  await page.goto('/editor'); await expect(page.getByText('Updated existing private draft', { exact: true }).first()).toBeVisible();
  const stale = await request.post('/api/agent/v1/design', { headers: { ...headers, 'Idempotency-Key': `stale-design-${String(Date.now())}` }, data: { stateVersion: current.stateVersion, design } });
  expect(stale.status()).toBe(409); expect(await stale.json()).toHaveProperty('error.code', 'state_changed');
  const beforePublish: unknown = await (await request.get('/api/agent/v1/context', { headers })).json();
  expect(beforePublish).toMatchObject({ canPublish: false, postCounts: { total: 2, selected: 2 }, publication: { status: 'changes_pending', publicUrl: publicUrl.href } });
  const upgrade = await runCliProcess(['login', '--no-wait', '--allow-publish', '--origin', origin], resumed.state);
  expect(upgrade.exitCode).toBe(0); expect(upgrade.state.credentials).toEqual(resumed.state.credentials);
  const publishApproval = upgrade.output[0] as { authorizationUrl: string; canPublish: boolean };
  expect(publishApproval.canPublish).toBe(true);
  await page.goto(publishApproval.authorizationUrl);
  await page.setViewportSize({ width: 390, height: 844 }); await expectNoHorizontalOverflow(page);
  const approvePublish = page.getByRole('button', { name: 'Authorize draft and publishing access', exact: true });
  await approvePublish.focus(); await expect(approvePublish).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('agent-publish-consent-mobile.png'), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; }); await expectNoHorizontalOverflow(page);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: testInfo.outputPath('agent-publish-consent-desktop.png'), fullPage: true });
  await approvePublish.click(); await expect(page.getByRole('heading', { name: 'Draft and publishing access approved' })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, (upgrade.state.pairing?.nextPollAt ?? 0) - Date.now())));
  const publisher = await runCliProcess(['login', '--no-wait', '--allow-publish', '--origin', origin], upgrade.state);
  expect(publisher.exitCode).toBe(0); expect(publisher.output[0]).toMatchObject({ status: 'authorized', canPublish: true });
  const publishCredentials = publisher.state.credentials; if (!publishCredentials) throw new Error('Missing publish authorization');
  expect((await request.get('/api/agent/v1/context', { headers })).status()).toBe(401);
  headers.authorization = `Bearer ${publishCredentials.token}`;
  const fresh = await (await request.get('/api/agent/v1/context', { headers })).json() as { stateVersion: string };
  const publishKey = `agent-publish-${String(Date.now())}`;
  const publishBody = { stateVersion: fresh.stateVersion };
  const published = await request.post('/api/agent/v1/publish', { headers: { ...headers, 'Idempotency-Key': publishKey }, data: publishBody });
  expect(published.status()).toBe(202); const publishing = await published.json() as { operationId: string };
  expect(await (await request.post('/api/agent/v1/publish', { headers: { ...headers, 'Idempotency-Key': publishKey }, data: publishBody })).json()).toEqual(publishing);
  await expect.poll(async () => (await (await request.get(`/api/agent/v1/operations/${publishing.operationId}`, { headers })).json() as { status: string }).status, { timeout: 30_000, intervals: [1000] }).toBe('succeeded');
  expect(await (await request.get('/api/agent/v1/context', { headers })).json()).toHaveProperty('publication', { status: 'current', publicUrl: publicUrl.href });
  for (const path of ['/', '/blog/hello-vibelog/', '/search/', '/rss.xml', '/llms.txt']) expect((await request.get(new URL(path, publicUrl).href)).status()).toBe(200);
  expect(await (await request.get(new URL('/design.css', publicUrl).href)).text()).not.toBe(liveStyle);
  expect(await (await request.post('/api/agent/v1/publish', { headers: { ...headers, 'Idempotency-Key': `publish-noop-${String(Date.now())}` }, data: publishBody })).json()).toEqual({ status: 'unchanged' });
  await page.goto('/account/agents');
  await page.setViewportSize({ width: 390, height: 844 }); await expectNoHorizontalOverflow(page);
  const promptSummary = page.locator('summary').filter({ hasText: 'Continue with your agent' });
  await promptSummary.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Agent prompt')).toContainText('Reuse my existing blog and saved design');
  await page.getByRole('button', { name: 'Copy agent prompt' }).click();
  await expect(page.locator('[data-agent-copy-status]')).toHaveText(/Copied\.|Select and copy/u);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('agent-access-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: testInfo.outputPath('agent-access-desktop.png'), fullPage: true });
  await page.goto('/account/agents'); await page.getByRole('button', { name: 'Revoke access' }).click();
  expect((await request.get('/api/agent/v1/context', { headers })).status()).toBe(401);
  // The migration rehearsal that follows uses Alice's retained blog as its only fixture.
  await page.goto('/editor'); await openDisclosure(page, 'danger-zone');
  await page.getByLabel(`Type ${email} to confirm`).fill(email);
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/auth\/login\?deleted=1$/u);
  expect((await request.get(publicUrl.href)).status()).toBe(404);
  // Return-to values outside the whitelist cannot redirect sign-out to another site.
  const cleanupLink = await requestMagicLink(page, request, mailpitUrl, `cleanup-${email}`);
  await page.goto(cleanupLink);
  await page.goto(pairing.authorizationUrl);
  await expect(page.getByRole('heading', { name: 'Request unavailable' })).toBeVisible();
  await expect(page.getByText(pairing.userCode, { exact: true })).toHaveCount(0);
  const logoutToken = await page.locator('form[action="/auth/logout"] input[name="csrfToken"]').inputValue();
  const logout = await page.request.post('/auth/logout', { headers: { origin }, form: { csrfToken: logoutToken, returnTo: 'https://example.com' }, maxRedirects: 0 });
  expect(logout.status()).toBe(303); expect(logout.headers().location).toBe('/auth/login');
  expect(csrf).toBeTruthy(); expect(errors).toEqual([]);
});


test('browser-approved agent publishes its first release through the CLI', async ({ page, request }) => {
  test.setTimeout(180_000);
  const origin = process.env.E2E_APP_ORIGIN; const mailpit = process.env.E2E_MAILPIT_URL;
  if (!origin || !mailpit) throw new Error('Missing E2E origins');
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const started = await runCliProcess(['login', '--no-wait', '--allow-publish', '--origin', origin]);
  expect(started.exitCode).toBe(0);
  const approval = started.output[0] as { authorizationUrl: string; userCode: string };
  const email = `publisher-${String(Date.now())}@example.com`;
  const link = await requestMagicLink(page, request, mailpit, email, `/agent/authorize?code=${approval.userCode}`);
  await page.goto(link); await page.getByRole('button', { name: 'Authorize draft and publishing access', exact: true }).click();
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, (started.state.pairing?.nextPollAt ?? 0) - Date.now())));
  const authorized = await runCliProcess(['login', '--no-wait', '--allow-publish', '--origin', origin], started.state);
  expect(authorized.exitCode).toBe(0); expect(authorized.output[0]).toMatchObject({ status: 'authorized', canPublish: true });
  const cli = (args: string[], input?: unknown) => runCliProcess([...args, '--origin', origin], authorized.state, input === undefined ? undefined : JSON.stringify(input));
  const username = `publisher-${String(Date.now())}`;
  const connected = await cli(['connect', '--file', '-', '--request-key', `connect-${String(Date.now())}`], { username, hackmdUsername: 'alice-hackmd', language: 'en' });
  expect(connected.exitCode).toBe(0); const connect = connected.output[0] as { operationId: string };
  expect((await cli(['wait', connect.operationId])).output[0]).toMatchObject({ status: 'succeeded' });
  const before = (await cli(['context'])).output[0] as { stateVersion: string; design: BlogDesignSpecV2 };
  expect(before).toMatchObject({ publication: { status: 'not_published', publicUrl: null }, postCounts: { total: 2, selected: 2 } });
  const publicUrl = new URL(origin); publicUrl.hostname = `${username}.${publicUrl.hostname}`;
  expect((await request.get(publicUrl.href)).status()).toBe(404);
  const design = { ...before.design, description: 'First agent-published design', theme: { ...before.design.theme, typography: { ...before.design.theme.typography, bodyFont: 'system-mono' } } };
  expect((await cli(['validate', '--file', '-'], { design })).output[0]).toMatchObject({ valid: true });
  const submitted = await cli(['design', '--file', '-', '--request-key', `design-${String(Date.now())}`], { stateVersion: before.stateVersion, design });
  expect(submitted.exitCode).toBe(0); const build = submitted.output[0] as { operationId: string };
  expect((await cli(['wait', build.operationId])).output[0]).toMatchObject({ status: 'succeeded' });
  const draft = (await cli(['context'])).output[0] as { stateVersion: string };
  expect(draft).toMatchObject({ publication: { status: 'not_published', publicUrl: null } });
  const published = await cli(['publish', '--file', '-', '--request-key', `publish-${String(Date.now())}`], { stateVersion: draft.stateVersion });
  expect(published.exitCode).toBe(0); const release = published.output[0] as { operationId: string };
  expect((await cli(['wait', release.operationId])).output[0]).toMatchObject({ status: 'succeeded' });
  expect((await cli(['context'])).output[0]).toMatchObject({ publication: { status: 'current', publicUrl: publicUrl.href } });
  for (const path of ['/', '/blog/hello-vibelog/', '/search/', '/rss.xml', '/llms.txt']) expect((await request.get(new URL(path, publicUrl).href)).status()).toBe(200);
  expect(JSON.stringify([started.output, authorized.output, connected.output, submitted.output, published.output])).not.toContain(authorized.state.credentials?.token);
  await page.goto('/editor'); await openDisclosure(page, 'danger-zone');
  await page.getByLabel(`Type ${email} to confirm`).fill(email); await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/auth\/login\?deleted=1$/u); expect(errors).toEqual([]);
});
