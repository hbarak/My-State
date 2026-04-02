import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const STORAGE_PREFIX = 'my-stocks:web:';

const KEYS = {
  providers: `${STORAGE_PREFIX}providers.v1`,
  integrations: `${STORAGE_PREFIX}provider-integrations.v1`,
  mappingProfiles: `${STORAGE_PREFIX}provider-mapping-profiles.v1`,
  holdingRecords: `${STORAGE_PREFIX}portfolio-holding-records.v1`,
  importRuns: `${STORAGE_PREFIX}portfolio-import-runs.v1`,
  accounts: `${STORAGE_PREFIX}accounts.v1`,
};

export async function clearAllData(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
}

/**
 * Navigate to import tab and ensure the app is ready to accept a file upload.
 * Creates a test account if none exist (fresh localStorage has no accounts
 * because the bootstrap creates the provider AFTER ensureDefaultAccounts runs).
 */
export async function goToImportReady(page: Page): Promise<void> {
  // Navigate to Data tab (renamed from Import in S8)
  await page.getByRole('button', { name: 'Data' }).click();

  // Wizard step 1: choose source — click CSV Upload card
  await page.getByText('CSV Upload').click();

  // Wait for the account selector to be visible (wizard step 2)
  const accountSelect = page.locator('#account-select');
  await expect(accountSelect).toBeVisible({ timeout: 10_000 });
  // Bootstrap creates a default account automatically — no manual creation needed
}

export async function seedHoldingRecords(
  page: Page,
  records: readonly object[],
): Promise<void> {
  await page.evaluate(
    ({ key, data }) => localStorage.setItem(key, JSON.stringify(data)),
    { key: KEYS.holdingRecords, data: records },
  );
}

export async function seedImportRuns(
  page: Page,
  runs: readonly object[],
): Promise<void> {
  await page.evaluate(
    ({ key, data }) => localStorage.setItem(key, JSON.stringify(data)),
    { key: KEYS.importRuns, data: runs },
  );
}

export async function seedAccounts(
  page: Page,
  accounts: readonly object[],
): Promise<void> {
  await page.evaluate(
    ({ key, data }) => localStorage.setItem(key, JSON.stringify(data)),
    { key: KEYS.accounts, data: accounts },
  );
}
