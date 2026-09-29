import { defineConfig, devices } from '@playwright/test';

const APP_URL = process.env.KRIX_APP_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // The real upload + YouTube download pipeline takes minutes; serial so the
  // single GPU worker is not asked to run two pipelines at once.
  fullyParallel: false,
  workers: 1,
  timeout: 15 * 60 * 1000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
