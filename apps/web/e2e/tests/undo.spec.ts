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
  await expect(page.getByText(/Import completed/i)).toBeVisible({ timeout: 10_000 });

  // Verify holdings exist in Portfolio
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText('Positions')).toBeVisible({ timeout: 10_000 });

  // Go back to Import and undo
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByRole('button', { name: /Undo last import/i }).click();

  // Wait for undo to complete
  await expect(page.getByText(/Undid import run/i)).toBeVisible({ timeout: 10_000 });

  // Verify portfolio is now empty
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText(/No holdings imported yet/i)).toBeVisible({ timeout: 10_000 });
});
