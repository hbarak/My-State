import { defineConfig } from '@playwright/test';

/**
 * Playwright config for mock-mode E2E tests (VITE_MOCK_API=true).
 *
 * Uses `npm run dev:mock` so no real Psagot credentials, OTP, or EODHD API
 * key are required. All external API responses come from local fixture files.
 *
 * Run with:
 *   npx playwright test --config apps/web/e2e/playwright.mock.config.ts
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:mock',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
