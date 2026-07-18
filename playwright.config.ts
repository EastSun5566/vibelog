import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://app.vibelog.test:3100', trace: 'retain-on-failure', launchOptions: { args: ['--host-resolver-rules=MAP *.vibelog.test 127.0.0.1'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @vibelog/core build && pnpm exec tsx --tsconfig packages/app/tsconfig.json e2e/fixture-server.ts',
    url: 'http://localhost:3100/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
