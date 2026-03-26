import { test, expect } from '@playwright/test';
import { clearAllData } from '../helpers/seed';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await clearAllData(page);
  await page.reload();
  await page.waitForSelector('button:has-text("Portfolio")');
});

test.fixme('R5-E2E-01: API sync + OTP flow → portfolio updates', async ({ page }) => {
  // Navigate to Import tab
  await page.getByRole('button', { name: 'Import' }).click();

  // Trigger API sync (sync button)
  await page.getByRole('button', { name: /sync/i }).click();

  // OTP modal should appear
  const otpModal = page.locator('[data-testid="otp-modal"]');
  await expect(otpModal).toBeVisible({ timeout: 15_000 });

  // Enter OTP (mocked in test environment)
  await otpModal.locator('input[type="text"]').fill('123456');
  await otpModal.getByRole('button', { name: /verify|submit/i }).click();

  // Sync should complete
  await expect(page.getByText(/Sync completed/i)).toBeVisible({ timeout: 15_000 });

  // Portfolio should show updated holdings
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText('Positions')).toBeVisible({ timeout: 10_000 });
  const table = page.locator('table');
  await expect(table).toBeVisible();
});

test.fixme('R5-E2E-02: partial sync failure shows "Retry Failed" button', async ({ page }) => {
  // Navigate to Import tab
  await page.getByRole('button', { name: 'Import' }).click();

  // Trigger API sync — partial failure scenario (some accounts fail)
  await page.getByRole('button', { name: /sync/i }).click();

  // Complete OTP
  const otpModal = page.locator('[data-testid="otp-modal"]');
  await expect(otpModal).toBeVisible({ timeout: 15_000 });
  await otpModal.locator('input[type="text"]').fill('123456');
  await otpModal.getByRole('button', { name: /verify|submit/i }).click();

  // Partial failure: some accounts synced, some errored
  // "Retry Failed" button should appear (not "Sync Again")
  const retryBtn = page.getByRole('button', { name: /retry failed/i });
  await expect(retryBtn).toBeVisible({ timeout: 15_000 });

  // Clicking "Retry Failed" should reset to credentials/sync entry point
  await retryBtn.click();
  await expect(page.getByRole('button', { name: /sync/i })).toBeVisible({ timeout: 10_000 });
});
