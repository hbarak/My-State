// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hasMigrationCompleted,
  hasLocalStorageData,
  runMigration,
  MIGRATION_TOTAL_STEPS,
} from '../localStorageMigration';

// ─────────────────────────────────────────────────────────────────────────────
// localStorage mock
// ─────────────────────────────────────────────────────────────────────────────

const storage: Record<string, string> = {};

beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k]);

  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client mock
// ─────────────────────────────────────────────────────────────────────────────

function makeSupabaseClient(error: unknown = null) {
  return {
    from: vi.fn((table: string) => ({
      upsert: vi.fn(() => Promise.resolve({ data: null, error: error ? { message: `${table} error` } : null })),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NOW = '2026-04-08T00:00:00.000Z';

const providerFixture = [{ id: 'prov-1', name: 'Test', status: 'active', createdAt: NOW, updatedAt: NOW }];
const holdingFixture = [{
  id: 'hr-1', providerId: 'prov-1', providerIntegrationId: 'int-1',
  accountId: 'acc-1', securityId: 'sec-1', securityName: 'Apple',
  actionType: 'buy', quantity: 10, costBasis: 100, currency: 'USD',
  actionDate: '2026-01-01', createdAt: NOW, updatedAt: NOW,
}];
const importRunFixture = [{
  id: 'run-1', providerId: 'prov-1', providerIntegrationId: 'int-1',
  sourceName: 'test.csv', status: 'success', startedAt: NOW,
  importedCount: 1, skippedCount: 0, errorCount: 0, isUndoable: true,
}];

// ─────────────────────────────────────────────────────────────────────────────
// hasMigrationCompleted
// ─────────────────────────────────────────────────────────────────────────────

describe('hasMigrationCompleted', () => {
  it('returns false when flag is not set', () => {
    expect(hasMigrationCompleted()).toBe(false);
  });

  it('returns false when flag has wrong value', () => {
    storage['my-stocks:web:supabase-migration-v1:done'] = 'false';
    expect(hasMigrationCompleted()).toBe(false);
  });

  it('returns true when flag is "true"', () => {
    storage['my-stocks:web:supabase-migration-v1:done'] = 'true';
    expect(hasMigrationCompleted()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasLocalStorageData
// ─────────────────────────────────────────────────────────────────────────────

describe('hasLocalStorageData', () => {
  it('returns false when no keys are present', () => {
    expect(hasLocalStorageData()).toBe(false);
  });

  it('returns false when keys exist but contain empty arrays', () => {
    storage['my-stocks:web:providers.v1'] = '[]';
    storage['my-stocks:web:portfolio-holding-records.v1'] = '[]';
    storage['my-stocks:web:portfolio-import-runs.v1'] = '[]';
    expect(hasLocalStorageData()).toBe(false);
  });

  it('returns false when keys exist but contain malformed JSON', () => {
    storage['my-stocks:web:providers.v1'] = 'not-json';
    expect(hasLocalStorageData()).toBe(false);
  });

  it('returns true when providers key has data', () => {
    storage['my-stocks:web:providers.v1'] = JSON.stringify(providerFixture);
    expect(hasLocalStorageData()).toBe(true);
  });

  it('returns true when holding records key has data', () => {
    storage['my-stocks:web:portfolio-holding-records.v1'] = JSON.stringify(holdingFixture);
    expect(hasLocalStorageData()).toBe(true);
  });

  it('returns true when import runs key has data', () => {
    storage['my-stocks:web:portfolio-import-runs.v1'] = JSON.stringify(importRunFixture);
    expect(hasLocalStorageData()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runMigration
// ─────────────────────────────────────────────────────────────────────────────

describe('runMigration', () => {
  it('calls onProgress 12 times (once per step)', async () => {
    const client = makeSupabaseClient();
    const onProgress = vi.fn();
    await runMigration(client as never, 'user-123', onProgress);
    expect(onProgress).toHaveBeenCalledTimes(MIGRATION_TOTAL_STEPS);
    expect(onProgress).toHaveBeenLastCalledWith(12, 12);
  });

  it('writes completion flag after all 12 steps succeed', async () => {
    const client = makeSupabaseClient();
    await runMigration(client as never, 'user-123', vi.fn());
    expect(storage['my-stocks:web:supabase-migration-v1:done']).toBe('true');
  });

  it('does NOT write completion flag if a step fails', async () => {
    // Seed providers so the first upsert call actually fires
    storage['my-stocks:web:providers.v1'] = JSON.stringify(providerFixture);
    const client = {
      from: vi.fn(() => ({
        upsert: vi.fn(() => Promise.resolve({ data: null, error: { message: 'insert failed' } })),
      })),
    };
    await expect(runMigration(client as never, 'user-123', vi.fn())).rejects.toThrow('Migration failed');
    expect(storage['my-stocks:web:supabase-migration-v1:done']).toBeUndefined();
  });

  it('calls onProgress for each step regardless of empty tables', async () => {
    // All tables empty — upsertInBatches no-ops, but onProgress still fires
    const client = makeSupabaseClient();
    const steps: number[] = [];
    await runMigration(client as never, 'user-123', (step) => steps.push(step));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('applies migrateAccountId transform — null accountId becomes "default"', async () => {
    const recordWithoutAccountId = {
      id: 'hr-2', providerId: 'prov-1', providerIntegrationId: 'int-1',
      accountId: undefined, securityId: 'sec-2', securityName: 'Google',
      actionType: 'buy', quantity: 5, costBasis: 200, currency: 'USD',
      actionDate: '2026-01-01', createdAt: NOW, updatedAt: NOW,
    };
    storage['my-stocks:web:portfolio-holding-records.v1'] = JSON.stringify([recordWithoutAccountId]);

    const capturedRows: unknown[] = [];
    const client = {
      from: vi.fn((table: string) => ({
        upsert: vi.fn((rows: unknown[]) => {
          if (table === 'provider_holding_records') {
            capturedRows.push(...rows);
          }
          return Promise.resolve({ data: null, error: null });
        }),
      })),
    };

    await runMigration(client as never, 'user-123', vi.fn());
    const row = capturedRows[0] as Record<string, unknown>;
    expect(row.account_id).toBe('default');
  });

  it('injects user_id into every row', async () => {
    storage['my-stocks:web:providers.v1'] = JSON.stringify(providerFixture);
    const USER_ID = 'test-user-xyz';
    const capturedProviderRows: unknown[] = [];
    const client = {
      from: vi.fn((table: string) => ({
        upsert: vi.fn((rows: unknown[]) => {
          if (table === 'providers') capturedProviderRows.push(...rows);
          return Promise.resolve({ data: null, error: null });
        }),
      })),
    };

    await runMigration(client as never, USER_ID, vi.fn());
    const row = capturedProviderRows[0] as Record<string, unknown>;
    expect(row.user_id).toBe(USER_ID);
  });

  it('handles empty localStorage gracefully (no-ops for empty tables)', async () => {
    // All blobs missing — should still complete all 12 steps without error
    const client = makeSupabaseClient();
    const onProgress = vi.fn();
    await expect(runMigration(client as never, 'user-123', onProgress)).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenCalledTimes(MIGRATION_TOTAL_STEPS);
  });
});
