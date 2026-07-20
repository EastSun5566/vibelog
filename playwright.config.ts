import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://app.localtest.me:3100', trace: 'retain-on-failure', launchOptions: { args: ['--host-resolver-rules=MAP *.localtest.me 127.0.0.1'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @vibelog/core build && pnpm --filter @vibelog/app css:build --minify && pnpm --filter @vibelog/app exec tsx --tsconfig tsconfig.json ../../e2e/fixture-server.ts',
    url: 'http://localhost:3100/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
