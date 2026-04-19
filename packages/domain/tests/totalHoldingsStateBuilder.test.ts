import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { TotalHoldingsStateBuilder } from '../src/services/TotalHoldingsStateBuilder';
import type { PortfolioImportRun, ProviderHoldingRecord } from '../src/types';

class InMemoryStore implements JsonStore {
  private readonly mem = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.mem.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
  }
}

function run(overrides: Partial<PortfolioImportRun>): PortfolioImportRun {
  return {
    id: 'run-default',
    providerId: 'provider-1',
    providerIntegrationId: 'integration-1',
    sourceName: 'src.csv',
    status: 'success',
    startedAt: '2026-01-01T00:00:00.000Z',
    importedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    isUndoable: true,
    ...overrides,
  };
}

function holding(overrides: Partial<ProviderHoldingRecord>): ProviderHoldingRecord {
  return {
    id: 'holding-default',
    providerId: 'provider-1',
    providerIntegrationId: 'integration-1',
    importRunId: 'run-1',
    securityId: 'AAA',
    securityName: 'AAA Corp',
    actionType: 'קניה',
    quantity: 1,
    costBasis: 10,
    currency: 'ILS',
    actionDate: '2026-01-01',
    currentPrice: 11,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('TotalHoldingsStateBuilder — source preference', () => {
  it('branch (a): API wins — API records used, CSV records excluded for same security', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const builder = new TotalHoldingsStateBuilder(repository);

    await repository.addImportRun(run({ id: 'run-api', providerIntegrationId: 'api-integration' }));
    await repository.addImportRun(run({ id: 'run-csv', providerIntegrationId: 'csv-integration' }));

    // Same provider + securityId — API record has quantity 7, CSV has quantity 3
    await repository.upsertHoldingRecords([
      holding({ id: 'api-h1', importRunId: 'run-api', providerIntegrationId: 'api-integration', securityId: 'AAA', quantity: 7, costBasis: 10 }),
      holding({ id: 'csv-h1', importRunId: 'run-csv', providerIntegrationId: 'csv-integration', securityId: 'AAA', quantity: 3, costBasis: 10 }),
    ]);

    const state = await builder.build({ providerId: 'provider-1', apiIntegrationIds: new Set(['api-integration']) });

    const aaa = state.positions.find((p) => p.securityId === 'AAA');
    expect(aaa?.quantity).toBe(7); // API wins, CSV excluded
    expect(aaa?.sourceRecordIds).toEqual(['api-h1']);
    expect(aaa?.sourceRecordIds).not.toContain('csv-h1');
  });

  it('branch (b): CSV lot fields preserved — CSV records used when they coexist with API for a different security', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const builder = new TotalHoldingsStateBuilder(repository);

    await repository.addImportRun(run({ id: 'run-api', providerIntegrationId: 'api-integration' }));
    await repository.addImportRun(run({ id: 'run-csv', providerIntegrationId: 'csv-integration' }));

    // AAA has both API and CSV records — API should win
    // BBB has only CSV records — CSV preserved
    await repository.upsertHoldingRecords([
      holding({ id: 'api-aaa', importRunId: 'run-api', providerIntegrationId: 'api-integration', securityId: 'AAA', quantity: 5 }),
      holding({ id: 'csv-aaa', importRunId: 'run-csv', providerIntegrationId: 'csv-integration', securityId: 'AAA', quantity: 3 }),
      holding({ id: 'csv-bbb', importRunId: 'run-csv', providerIntegrationId: 'csv-integration', securityId: 'BBB', quantity: 4, costBasis: 50 }),
    ]);

    const state = await builder.build({ providerId: 'provider-1', apiIntegrationIds: new Set(['api-integration']) });

    const aaa = state.positions.find((p) => p.securityId === 'AAA');
    const bbb = state.positions.find((p) => p.securityId === 'BBB');

    expect(aaa?.quantity).toBe(5); // API wins for AAA
    expect(bbb?.quantity).toBe(4); // CSV preserved for BBB (no API record)
    expect(bbb?.sourceRecordIds).toEqual(['csv-bbb']);
  });

  it('branch (c): CSV fallback — all records used when no API integration IDs provided', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const builder = new TotalHoldingsStateBuilder(repository);

    await repository.addImportRun(run({ id: 'run-csv', providerIntegrationId: 'csv-integration' }));

    await repository.upsertHoldingRecords([
      holding({ id: 'csv-h1', importRunId: 'run-csv', providerIntegrationId: 'csv-integration', securityId: 'AAA', quantity: 3 }),
      holding({ id: 'csv-h2', importRunId: 'run-csv', providerIntegrationId: 'csv-integration', securityId: 'BBB', quantity: 2 }),
    ]);

    // No apiIntegrationIds — CSV is the only source, all records used
    const state = await builder.build({ providerId: 'provider-1' });

    expect(state.positionCount).toBe(2);
    expect(state.positions.find((p) => p.securityId === 'AAA')?.quantity).toBe(3);
    expect(state.positions.find((p) => p.securityId === 'BBB')?.quantity).toBe(2);
  });
});

describe('TotalHoldingsStateBuilder', () => {
  it('aggregates all lots per security and sums totals across lots', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const builder = new TotalHoldingsStateBuilder(repository);

    await repository.addImportRun(run({ id: 'run-1', startedAt: '2026-01-10T00:00:00.000Z' }));
    await repository.addImportRun(run({ id: 'run-2', startedAt: '2026-02-10T00:00:00.000Z' }));

    await repository.upsertHoldingRecords([
      // Two lots for AAA (same security, different dates/costs)
      holding({ id: 'h1', importRunId: 'run-1', securityId: 'AAA', quantity: 5, costBasis: 100, actionDate: '2026-01-15', currentPrice: 12 }),
      holding({ id: 'h2', importRunId: 'run-2', securityId: 'AAA', quantity: 4, costBasis: 120, actionDate: '2026-02-01', currentPrice: 13 }),
      // One lot for BBB
      holding({ id: 'h3', importRunId: 'run-2', securityId: 'BBB', quantity: 2, costBasis: 50, actionDate: '2026-02-01', currentPrice: 20, securityName: 'BBB Ltd' }),
    ]);

    const state = await builder.build({ providerId: 'provider-1' });

    expect(state.positionCount).toBe(2);
    expect(state.asOf).toBe('2026-02-01');
    // Total quantity: AAA(5+4) + BBB(2) = 11
    expect(state.quantityTotalsByCurrency.ILS).toBe(11);

    const aaa = state.positions.find((p) => p.securityId === 'AAA');
    expect(aaa?.quantity).toBe(9); // 5 + 4
    expect(aaa?.totalCost).toBe(980); // (5 * 100) + (4 * 120)
    expect(aaa?.costBasis).toBeCloseTo(980 / 9); // weighted avg
    expect(aaa?.lotCount).toBe(2);
    expect(aaa?.currentPrice).toBe(13); // from the latest lot by actionDate
    expect(aaa?.sourceRecordIds).toEqual(expect.arrayContaining(['h1', 'h2']));

    // Valuation: AAA = 9 * 13 = 117, BBB = 2 * 20 = 40
    expect(state.valuationTotalsByCurrency.ILS).toBe(157);

    const bbb = state.positions.find((p) => p.securityId === 'BBB');
    expect(bbb?.quantity).toBe(2);
    expect(bbb?.lotCount).toBe(1);
  });

  it('ignores failed/undone runs and deleted records', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const builder = new TotalHoldingsStateBuilder(repository);

    await repository.addImportRun(run({ id: 'run-success', status: 'success' }));
    await repository.addImportRun(run({ id: 'run-failed', status: 'failed' }));
    await repository.addImportRun(run({ id: 'run-undone', status: 'success', undoneAt: '2026-02-01T00:00:00.000Z' }));

    await repository.upsertHoldingRecords([
      holding({ id: 'ok', importRunId: 'run-success', securityId: 'AAA', quantity: 1, currentPrice: 100 }),
      holding({ id: 'failed', importRunId: 'run-failed', securityId: 'BBB', quantity: 2, currentPrice: 100 }),
      holding({ id: 'undone', importRunId: 'run-undone', securityId: 'CCC', quantity: 3, currentPrice: 100 }),
      holding({ id: 'deleted', importRunId: 'run-success', securityId: 'DDD', quantity: 4, deletedAt: '2026-02-02T00:00:00.000Z', currentPrice: 100 }),
      holding({ id: 'no-price', importRunId: 'run-success', securityId: 'EEE', quantity: 2, currentPrice: undefined }),
    ]);

    const state = await builder.build({ providerId: 'provider-1' });

    expect(state.positionCount).toBe(2);
    expect(state.positions.map((p) => p.securityId).sort()).toEqual(['AAA', 'EEE']);
    expect(state.quantityTotalsByCurrency.ILS).toBe(3);
    expect(state.valuationTotalsByCurrency.ILS).toBe(100);
    expect(state.insufficientData).toBe(true);
  });

  it('filters positions by accountId when provided', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const builder = new TotalHoldingsStateBuilder(repository);

    await repository.addImportRun(run({ id: 'run-1' }));

    await repository.upsertHoldingRecords([
      holding({ id: 'h1', importRunId: 'run-1', securityId: 'AAA', accountId: 'acct-1', quantity: 5, costBasis: 100, currentPrice: 12 }),
      holding({ id: 'h2', importRunId: 'run-1', securityId: 'AAA', accountId: 'acct-2', quantity: 3, costBasis: 120, currentPrice: 12 }),
      holding({ id: 'h3', importRunId: 'run-1', securityId: 'BBB', accountId: 'acct-1', quantity: 2, costBasis: 50, currentPrice: 20 }),
      holding({ id: 'h4', importRunId: 'run-1', securityId: 'BBB', accountId: 'acct-2', quantity: 4, costBasis: 60, currentPrice: 20 }),
    ]);

    // Filter to acct-1 only
    const state = await builder.build({ providerId: 'provider-1', accountId: 'acct-1' });

    expect(state.positionCount).toBe(2);
    const aaa = state.positions.find((p) => p.securityId === 'AAA');
    const bbb = state.positions.find((p) => p.securityId === 'BBB');

    // Only acct-1 lots included
    expect(aaa?.quantity).toBe(5);
    expect(aaa?.sourceRecordIds).toEqual(['h1']);
    expect(bbb?.quantity).toBe(2);
    expect(bbb?.sourceRecordIds).toEqual(['h3']);

    // Totals reflect filtered data only
    expect(state.quantityTotalsByCurrency.ILS).toBe(7); // 5 + 2
  });

  it('returns all accounts when accountId is not provided', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const builder = new TotalHoldingsStateBuilder(repository);

    await repository.addImportRun(run({ id: 'run-1' }));

    await repository.upsertHoldingRecords([
      holding({ id: 'h1', importRunId: 'run-1', securityId: 'AAA', accountId: 'acct-1', quantity: 5, costBasis: 100, currentPrice: 12 }),
      holding({ id: 'h2', importRunId: 'run-1', securityId: 'AAA', accountId: 'acct-2', quantity: 3, costBasis: 120, currentPrice: 12 }),
    ]);

    // No accountId — all records included
    const state = await builder.build({ providerId: 'provider-1' });

    const aaa = state.positions.find((p) => p.securityId === 'AAA');
    expect(aaa?.quantity).toBe(8); // 5 + 3
    expect(aaa?.sourceRecordIds).toEqual(expect.arrayContaining(['h1', 'h2']));
  });

  it('produces deterministic recordSetHash for the same included records', async () => {
    const store = new InMemoryStore();
    const repository = new LocalPortfolioRepository(store);
    const builder = new TotalHoldingsStateBuilder(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      holding({ id: 'r2', importRunId: 'run-1', securityId: 'BBB', quantity: 2 }),
      holding({ id: 'r1', importRunId: 'run-1', securityId: 'AAA', quantity: 1 }),
    ]);

    const a = await builder.build({ providerId: 'provider-1' });
    const b = await builder.build({ providerId: 'provider-1' });

    expect(a.recordSetHash).toBe(b.recordSetHash);
    expect(a.snapshotId).toBe(b.snapshotId);
  });
});
