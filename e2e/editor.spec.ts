import { expect, test } from '@playwright/test';

test('invite signup to hosted publication', async ({ page }) => {
  await page.goto('/auth/register');
  await page.getByLabel('Beta 邀請碼').fill('vibelog-e2e-beta-invite-code');
  await page.getByLabel('Username').fill('alice');
  await page.getByLabel('密碼').fill('a-long-enough-test-password');
  await page.getByRole('button', { name: '建立帳號' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByLabel('HackMD username').fill('alice-hackmd');
  await page.getByRole('button', { name: '同步並建立預覽' }).click();
  await expect(page).toHaveURL(/\/editor$/, { timeout: 120_000 });
  const preview = page.frameLocator('iframe[title*="即時預覽"]');
  await expect(preview.getByRole('heading', { name: 'Alice Writer', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('描述你想要的感覺').fill('像一本溫暖而克制的獨立雜誌');
  await page.getByRole('button', { name: '產生新樣式' }).click();
  await expect(page.getByText('A warm editorial theme.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '切換' }).click();
  await expect(page.getByText('使用中')).toBeVisible();

  await page.getByRole('button', { name: /發布到/ }).click();
  await expect(page.getByRole('link', { name: '查看已發布網站' })).toBeVisible({ timeout: 30_000 });
  await page.goto('http://alice.app.localtest.me:3100/');
  await expect(page.getByRole('heading', { name: 'Alice Writer', exact: true })).toBeVisible();
  await page.goto('http://alice.app.localtest.me:3100/blog/hello-vibelog/');
  await expect(page.getByRole('heading', { name: 'Hello VibeLog' })).toBeVisible();
});
