import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearAllData, goToImportReady } from '../helpers/seed';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await clearAllData(page);
  await page.reload();
  await page.waitForSelector('button:has-text("Portfolio")');
});

test('undo removes last imported data', async ({ page }) => {
  // Import data
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 10_000 });

  // Click Undo from the done step (before navigating away — wizard resets on remount)
  await page.getByRole('button', { name: 'Undo' }).click();

  // Wait for undo to complete — "Import another" button re-enables (isBusy goes false)
  await expect(page.getByRole('button', { name: 'Import another' })).toBeEnabled({ timeout: 10_000 });

  // Verify portfolio is now empty
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(page.getByText(/No holdings imported yet/i)).toBeVisible({ timeout: 10_000 });
});
