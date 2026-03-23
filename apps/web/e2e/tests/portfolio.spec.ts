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

test('portfolio shows "no holdings" when empty', async ({ page }) => {
  await expect(page.getByText(/No holdings imported yet/i)).toBeVisible({ timeout: 10_000 });
});

test('portfolio shows positions after import', async ({ page }) => {
  // Import data first
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText(/Import completed/i)).toBeVisible({ timeout: 10_000 });

  // Switch to Portfolio
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText('Positions')).toBeVisible({ timeout: 10_000 });

  const table = page.locator('table');
  await expect(table).toBeVisible();

  // Verify position table headers
  await expect(table.locator('th:has-text("Security")')).toBeVisible();
  await expect(table.locator('th:has-text("Qty")')).toBeVisible();
  await expect(table.locator('th:has-text("Value")')).toBeVisible();
});

test('click position row — expands drill-down', async ({ page }) => {
  // Import data
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText(/Import completed/i)).toBeVisible({ timeout: 10_000 });

  // Go to Portfolio
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText('Positions')).toBeVisible({ timeout: 10_000 });

  // Click the first position row to expand drill-down
  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();

  // Wait for drill-down panel to appear (has data-testid="security-drilldown")
  const drilldown = page.locator('[data-testid="security-drilldown"]');
  await expect(drilldown).toBeVisible({ timeout: 10_000 });

  // Verify drill-down has content (lot table or close button)
  await expect(drilldown.getByRole('button', { name: 'Close' })).toBeVisible();
});
