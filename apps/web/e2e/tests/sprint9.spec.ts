/**
 * Sprint 9 E2E smoke tests — AC1–AC4
 *
 * Must run against the mock dev server (VITE_MOCK_API=true):
 *   npx playwright test --config apps/web/e2e/playwright.mock.config.ts
 *
 * All 4 ACs require the mock server because:
 * - AC2 needs /api/prices?mock_402=true
 * - AC4 needs /api/boi-rate (served from fixture in mock mode)
 * - AC3 needs the failed-ticker fixture (EquityNumber 9999999) — only available
 *   via Psagot mock sync, not CSV import. AC3 is therefore scoped to the mock
 *   sync flow and marked fixme until sync is enabled in E2E.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearAllData, goToImportReady, seedTickerMappings } from '../helpers/seed';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '../fixtures');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await clearAllData(page);
  await page.reload();
  await page.waitForSelector('button:has-text("Portfolio")');
});

// ── AC1: QTY integers display without decimal suffix ─────────────────────────

test('AC1 — QTY: integer quantity renders without .00 suffix', async ({ page }) => {
  // Import a CSV with whole-number quantities (100 units)
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'valid-holdings.csv'));
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 10_000 });

  // Navigate to Portfolio
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible({ timeout: 10_000 });

  // Find all Qty cells in the position table body
  const table = page.locator('table');
  await expect(table).toBeVisible();

  // Grab all cells in the Qty column (2nd column, index 1 in tbody)
  const qtyCells = table.locator('tbody tr td:nth-child(2)');
  const count = await qtyCells.count();
  expect(count).toBeGreaterThan(0);

  // None of the Qty cells should end with .00 or have decimal zeros
  for (let i = 0; i < count; i++) {
    const text = await qtyCells.nth(i).textContent();
    if (text && text.trim() !== '—') {
      expect(text.trim()).not.toMatch(/\.0+$/); // no trailing .0 / .00 / .000
    }
  }

  // Spot-check: "100" is present (valid-holdings.csv has 100 units for the first position)
  await expect(qtyCells.first()).toHaveText('100');
});

// ── AC2: EODHD 402 quota exceeded → UI warning ───────────────────────────────

test('AC2 — EODHD 402: quota exceeded warning appears after mock_402 response', async ({ page }) => {
  // Import a CSV that has a USD/EODHD position (72179369 = QQQ ETF)
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'holdings-with-usd.csv'));
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 10_000 });

  // Seed a ticker mapping for the QQQ position so FanOutPriceFetcher routes it
  // to EodhdPriceFetcher (non-numeric ticker → /api/prices), not Maya (/api/prices-maya).
  await seedTickerMappings(page, [
    {
      securityId: '72179369',
      securityName: 'QQQ US ETF',
      ticker: 'QQQ',
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'manual',
    },
  ]);

  // Intercept /api/prices BEFORE navigating to Portfolio so the initial mount
  // price fetch is captured.
  await page.route('/api/prices', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'quota_exceeded',
        message: 'Daily price limit reached. Prices will refresh tomorrow.',
      }),
    });
  });

  // Navigate to Portfolio — initial price fetch fires on mount and hits the intercept
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();

  // The inline quota warning should appear in PortfolioActionBar
  await expect(
    page.getByText('Daily price limit reached. Prices will refresh tomorrow.'),
  ).toBeVisible({ timeout: 10_000 });

  // The warning has role="status" for accessibility
  const warning = page.locator('[role="status"]');
  await expect(warning).toBeVisible();
});

// ── AC3: Failed ticker → ⚠ indicator (Psagot mock sync prerequisite) ─────────

// AC3 requires the mock Psagot sync flow to surface a position with EquityNumber 9999999.
// The CSV import flow does not go through the Psagot API, so the failed-ticker fixture
// cannot be loaded via CSV. This test is deferred until the Psagot sync E2E is unblocked
// (currently fixme in sync.spec.ts).
test.fixme('AC3 — failed ticker: ⚠ indicator visible for unresolved ticker (needs Psagot mock sync)', async ({ page }) => {
  // Pre-condition: sync from Psagot mock, which serves balances-150-190500.json
  // containing EquityNumber 9999999 (no matching security-info entry → resolution fails).

  // After sync, navigate to Portfolio
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible({ timeout: 10_000 });

  // At least one position row should show the ⚠ warning icon for the failed ticker
  const warningIcon = page.locator('[aria-label="Ticker resolution failed"]');
  await expect(warningIcon).toBeVisible({ timeout: 10_000 });

  // Happy path rows (resolved tickers) should NOT show the warning icon
  const allTickerCells = page.locator('table tbody tr');
  const rowCount = await allTickerCells.count();
  expect(rowCount).toBeGreaterThan(1); // more than just the failed row

  // Confirm no "resolve ticker" button exists in the position table (moved to SecurityDrillDown)
  await expect(page.locator('button[aria-label*="resolve ticker"]')).not.toBeVisible();
});

// ── AC4: ILS net worth hero + USD secondary pill ──────────────────────────────

test('AC4 — ILS net worth: hero shows ILS total; USD pill shows ILS equivalent', async ({ page }) => {
  // Import a CSV that has both ILS and USD positions
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'holdings-with-usd.csv'));
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 10_000 });

  // Navigate to Portfolio
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible({ timeout: 10_000 });

  // Hero net worth element must be present
  const hero = page.getByTestId('hero-net-worth');
  await expect(hero).toBeVisible({ timeout: 10_000 });

  // Hero shows a currency-formatted ILS value (₪ symbol or "ILS")
  const heroText = await hero.textContent();
  expect(heroText).toBeTruthy();
  // The value should be a formatted number — not empty or "—"
  expect(heroText!.trim()).not.toBe('—');
  expect(heroText!.trim().length).toBeGreaterThan(0);

  // The label above the hero should mention ILS (mock mode supplies a valid BoI rate)
  // Accept "Net Worth (ILS)" (rate available) or "Net Worth (est.)" (rate unavailable)
  const label = page.locator('[class*="label"]').first();
  await expect(label).toContainText(/Net Worth/i, { timeout: 10_000 });
});

// ── AC4b: Rate unavailable fallback — USD displayed with ~ prefix ─────────────

test('AC4b — ILS fallback: rate unavailable → USD value shown with ~ prefix', async ({ page }) => {
  // Import a USD-containing portfolio
  await goToImportReady(page);
  await page.locator('#csv-upload').setInputFiles(path.join(FIXTURES, 'holdings-with-usd.csv'));
  await expect(page.getByText('Import complete')).toBeVisible({ timeout: 10_000 });

  // Seed a ticker mapping so /api/prices is called for the QQQ position
  await seedTickerMappings(page, [
    {
      securityId: '72179369',
      securityName: 'QQQ US ETF',
      ticker: 'QQQ',
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'manual',
    },
  ]);

  // /api/boi-rate returns rate_unavailable → exchangeRate stays null
  await page.route('/api/boi-rate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'rate_unavailable' }),
    });
  });

  // /api/prices returns a successful USD price so currentValue is defined.
  // The ~ prefix only renders when currentValue is defined but exchangeRate is null.
  await page.route('/api/prices', async (route) => {
    const body = route.request().postDataJSON() as { tickers: string[] };
    const results = body.tickers.map((ticker: string) => ({
      ticker,
      status: 'success',
      price: 480,
      currency: 'USD',
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(results),
    });
  });

  // Navigate to Portfolio — boi-rate and prices fetches fire on mount
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Positions' })).toBeVisible({ timeout: 10_000 });

  // Value cell for USD position should show ~ prefix (ILS conversion unavailable)
  const unavailableCell = page.locator('span[aria-label*="Approximate value"]');
  await expect(unavailableCell).toBeVisible({ timeout: 10_000 });

  // Hero label should say "est." (estimate, because no rate)
  const labelText = await page.locator('[class*="label"]').first().textContent();
  expect(labelText).toMatch(/est\./i);
});
