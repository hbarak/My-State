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

test.fixme('R5-E2E-03: data transparency panel — CSV import run visible with JSON accordion', async ({ page }) => {
  // Import CSV data
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText(/Import completed/i)).toBeVisible({ timeout: 10_000 });

  // Navigate to Data tab
  await page.getByRole('button', { name: 'Data' }).click();
  const dataTab = page.locator('[data-testid="data-tab"]');
  await expect(dataTab).toBeVisible({ timeout: 10_000 });

  // At least one import run should be listed
  const runItem = dataTab.locator('[data-testid^="import-run-"]').first();
  await expect(runItem).toBeVisible({ timeout: 10_000 });

  // Expand the run accordion
  await runItem.click();

  // Raw rows JSON panel should be visible
  await expect(dataTab.locator('pre')).toBeVisible({ timeout: 10_000 });

  // Mapped records panel should also be visible
  await expect(dataTab.getByText(/Mapped records/i)).toBeVisible({ timeout: 10_000 });

  // JSON content should be non-empty
  const jsonContent = await dataTab.locator('pre').first().textContent();
  expect(jsonContent).toBeTruthy();
  expect(jsonContent!.length).toBeGreaterThan(2); // more than "{}" or "[]"
});
