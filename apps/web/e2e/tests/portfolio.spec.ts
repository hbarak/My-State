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
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 10_000 });

  // Switch to Portfolio
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible({ timeout: 10_000 });

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
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 10_000 });

  // Go to Portfolio
  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible({ timeout: 10_000 });

  // Click the first position row to expand drill-down
  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();

  // Wait for drill-down panel to appear (has data-testid="security-drilldown")
  const drilldown = page.locator('[data-testid="security-drilldown"]');
  await expect(drilldown).toBeVisible({ timeout: 10_000 });

  // Verify drill-down has content (lot table or close button)
  await expect(drilldown.getByRole('button', { name: 'Close' })).toBeVisible();
});

// ── Deferred R4 tests ──────────────────────────────────────────────────────

test.fixme('H3: summary card totals match portfolio data', async ({ page }) => {
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Portfolio' }).click();

  // Summary cards should show non-empty numeric values
  await expect(page.locator('[data-testid="summary-value"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="summary-cost"]')).toBeVisible();
  await expect(page.locator('[data-testid="summary-gain-loss"]')).toBeVisible();
  await expect(page.locator('[data-testid="summary-gain-pct"]')).toBeVisible();

  const valueText = await page.locator('[data-testid="summary-value"]').textContent();
  expect(valueText).toMatch(/[\d,]+/);
});

test.fixme('H5: lot-level drill-down shows correct detail fields', async ({ page }) => {
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText('Positions')).toBeVisible({ timeout: 10_000 });

  const firstRow = page.locator('table tbody tr').first();
  await firstRow.click();

  const drilldown = page.locator('[data-testid="security-drilldown"]');
  await expect(drilldown).toBeVisible({ timeout: 10_000 });

  // Lot table should have expected column headers
  await expect(drilldown.locator('th:has-text("Date")')).toBeVisible();
  await expect(drilldown.locator('th:has-text("Action")')).toBeVisible();
  await expect(drilldown.locator('th:has-text("Qty")')).toBeVisible();
  await expect(drilldown.locator('th:has-text("Cost Basis")')).toBeVisible();
});

test.fixme('H6: multi-account section renders with per-account grouping', async ({ page }) => {
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Portfolio' }).click();
  await expect(page.getByText('Positions')).toBeVisible({ timeout: 10_000 });

  // Account sections should render with data-testid
  const accountSections = page.locator('[data-testid="account-section"]');
  await expect(accountSections.first()).toBeVisible({ timeout: 10_000 });
  const count = await accountSections.count();
  expect(count).toBeGreaterThan(0);
});

test.fixme('H8: undo button disabled after undo, re-enabled after new import', async ({ page }) => {
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 10_000 });

  // Undo button should be enabled after import
  const undoBtn = page.getByRole('button', { name: /undo/i });
  await expect(undoBtn).toBeEnabled({ timeout: 10_000 });

  // Click undo
  await undoBtn.click();
  await expect(page.getByText(/Undo successful/i)).toBeVisible({ timeout: 10_000 });

  // Undo button should be disabled after undo
  await expect(undoBtn).toBeDisabled({ timeout: 10_000 });

  // Import again — undo button should re-enable
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText("Import complete")).toBeVisible({ timeout: 10_000 });
  await expect(undoBtn).toBeEnabled({ timeout: 10_000 });
});
