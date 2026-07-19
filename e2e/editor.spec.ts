import { expect, test } from '@playwright/test';

test('invite signup to hosted publication', async ({ page }) => {
  await page.goto('/auth/register');
  await page.getByLabel('Beta 邀請碼').fill('vibelog-e2e-beta-invite-code');
  await page.getByLabel('Username').fill('alice');
  await page.getByLabel('密碼').fill('a-long-enough-test-password');
  await page.getByRole('button', { name: '建立帳號' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel('HackMD username').fill('missing-hackmd');
  const initialSync = page.getByRole('button', { name: '同步並建立預覽' });
  await initialSync.click();
  await expect(page.getByText('找不到這個公開 HackMD 使用者')).toBeVisible({ timeout: 30_000 });
  await expect(initialSync).toBeEnabled();
  await expect(page.locator('form[action="/actions/blog/connect"]')).not.toHaveAttribute('aria-busy');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel('HackMD username').fill('alice-hackmd');
  await page.getByRole('button', { name: '同步並建立預覽' }).click();
  await expect(page).toHaveURL(/\/editor$/, { timeout: 120_000 });
  await expect(page.getByText('尚未發布', { exact: true })).toBeVisible();
  await expect(page.getByText('已匯入文章（1）')).toBeVisible();
  await page.getByText('已匯入文章（1）').click();
  await expect(page.getByText('Hello VibeLog', { exact: true })).toBeVisible();
  const preview = page.frameLocator('iframe[title*="即時預覽"]');
  await expect(preview.getByRole('heading', { name: 'Alice Writer', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('Blog 標題').fill('Alice’s Field Notes');
  await page.getByLabel('Blog 描述').fill('Notes about humane software and careful tools.');
  await page.getByRole('button', { name: '儲存並重建草稿' }).click();
  await expect(page.getByRole('heading', { name: 'Alice’s Field Notes', exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(preview.getByRole('link', { name: 'Alice’s Field Notes', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByText('手動微調安全樣式').click();
  await page.getByLabel('Editorial').check();
  await page.getByLabel('Newsprint').check();
  await expect(page.getByText('預覽已更新，尚未儲存', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('這些樣式尚未儲存；儲存後才能發布。')).toBeVisible();
  await expect(page.getByRole('button', { name: /發布第一版到/ })).toBeDisabled();
  await page.getByRole('button', { name: '儲存成新版本' }).click();
  await expect(page).toHaveURL(/\/editor$/);
  await page.getByText(/歷史樣式/).click();
  await expect(page.getByText('Editorial · Newsprint · Sans / Sans · Medium')).toBeVisible();
  await expect(page.getByText('手動', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /發布第一版到/ }).click();
  await expect(page.getByText('已與線上版本同步', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('描述你想要的感覺').fill('像一本溫暖而克制的獨立雜誌');
  await page.getByRole('button', { name: '交給 AI 設計' }).click();
  await expect(page.getByText('有未發布變更', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByText(/歷史樣式/).click();
  await expect(page.getByText('A warm editorial theme.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('預覽中', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /發布變更到/ }).click();
  await expect(page.getByText('已與線上版本同步', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /已是最新版本/ })).toBeDisabled();
  await expect(page.getByRole('link', { name: '查看已發布網站' })).toBeVisible({ timeout: 30_000 });
  const aiCss = await (await page.request.get('http://alice.app.localtest.me:3100/theme.css')).text();
  await page.getByText('發布紀錄（2）', { exact: true }).click();
  await expect(page.getByText('目前線上', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '還原為線上版本' }).click();
  await expect(page.getByText('有未發布變更', { exact: true })).toBeVisible();
  const restoredCss = await (await page.request.get('http://alice.app.localtest.me:3100/theme.css')).text();
  expect(restoredCss).not.toBe(aiCss);
  await page.getByText('發布紀錄（2）', { exact: true }).click();
  await page.getByRole('button', { name: '還原為線上版本' }).click();
  await expect(page.getByText('已與線上版本同步', { exact: true })).toBeVisible();
  await page.goto('http://alice.app.localtest.me:3100/');
  await expect(page.getByRole('heading', { name: 'Alice Writer', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Alice’s Field Notes');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Alice’s Field Notes');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Notes about humane software and careful tools.');
  await page.goto('http://alice.app.localtest.me:3100/blog/hello-vibelog/');
  await expect(page.getByRole('heading', { name: 'Hello VibeLog' })).toBeVisible();
  const rss = await page.request.get('http://alice.app.localtest.me:3100/rss.xml');
  expect(await rss.text()).toContain('<title>Alice’s Field Notes</title>');
});
