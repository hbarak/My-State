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

  // Wait for auto-commit (all rows valid → no "Action Required")
  await expect(page.getByText(/Import completed/i)).toBeVisible({ timeout: 10_000 });

  // Verify import summary
  await expect(page.getByText('Import Summary')).toBeVisible();

  // Switch to Portfolio tab and verify holdings appear
  await page.getByRole('button', { name: 'Portfolio' }).click();

  // Wait for portfolio to load and show positions
  await expect(page.getByText('Positions')).toBeVisible({ timeout: 10_000 });

  // Verify the position table is present with data
  const table = page.locator('table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr').first()).toBeVisible();
});

test('import CSV with invalid rows — shows error UI and allows continue', async ({ page }) => {
  await goToImportReady(page);

  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'mixed-holdings.csv'));

  // Should show "Action Required" because of the invalid row
  await expect(page.getByText('Action Required')).toBeVisible({ timeout: 10_000 });

  // Click "Continue with valid rows"
  await page.getByRole('button', { name: /Continue with valid rows/i }).click();

  // Wait for commit to complete
  await expect(page.getByText(/Import completed/i)).toBeVisible({ timeout: 10_000 });

  // Verify summary shows imported count
  await expect(page.getByText('Import Summary')).toBeVisible();
});

test('import CSV with invalid rows — cancel discards all', async ({ page }) => {
  await goToImportReady(page);

  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'mixed-holdings.csv'));

  await expect(page.getByText('Action Required')).toBeVisible({ timeout: 10_000 });

  // Cancel the import
  await page.getByRole('button', { name: /Cancel import/i }).click();

  // Verify cancellation message
  await expect(page.getByText(/Import canceled/i)).toBeVisible();

  // Switch to Portfolio and verify no holdings
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText(/No holdings imported yet/i)).toBeVisible({ timeout: 10_000 });
});
