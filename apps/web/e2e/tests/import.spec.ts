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

test('import valid CSV — holdings appear in portfolio', async ({ page }) => {
  await goToImportReady(page);

  // Upload the valid CSV
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));

  // Wait for auto-commit (all rows valid → wizard moves to done step)
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 10_000 });

  // Verify import summary counts are present
  await expect(page.getByText('Imported')).toBeVisible();

  // Switch to Portfolio tab and verify holdings appear
  await page.getByRole('button', { name: 'Portfolio' }).click();

  // Wait for portfolio to load and show positions
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible({ timeout: 10_000 });

  // Verify the position table is present with data
  const table = page.locator('table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr').first()).toBeVisible();
});

test('import CSV with invalid rows — shows error UI and allows continue', async ({ page }) => {
  await goToImportReady(page);

  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'mixed-holdings.csv'));

  // Should show preview step with valid/invalid counts
  await expect(page.getByText(/\d+ valid/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/\d+ invalid/).first()).toBeVisible();

  // Click "Import N valid rows"
  await page.getByRole('button', { name: /Import \d+ valid rows/i }).click();

  // Wait for commit to complete
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 10_000 });

  // Verify summary shows imported count
  await expect(page.getByText('Imported')).toBeVisible();
});

test('import CSV with invalid rows — cancel discards all', async ({ page }) => {
  await goToImportReady(page);

  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'mixed-holdings.csv'));

  await expect(page.getByText(/\d+ valid/).first()).toBeVisible({ timeout: 10_000 });

  // Cancel the import
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Verify cancellation message
  await expect(page.getByText(/Import cancelled/i)).toBeVisible();

  // Switch to Portfolio and verify no holdings
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText(/No holdings imported yet/i)).toBeVisible({ timeout: 10_000 });
});
