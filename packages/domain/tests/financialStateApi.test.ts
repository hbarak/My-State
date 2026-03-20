import { describe, expect, it } from 'vitest';
import { FinancialStateApi } from '../src/api/financialStateApi';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
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
    id: 'run-1',
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
    id: 'h1',
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

describe('FinancialStateApi', () => {
  it('returns total holdings summary', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const api = new FinancialStateApi(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      holding({ id: 'h1', securityId: 'AAA', quantity: 2, currentPrice: 20 }),
      holding({ id: 'h2', securityId: 'BBB', quantity: 3, currentPrice: 10, securityName: 'BBB Ltd' }),
    ]);

    const summary = await api.getTotalHoldingsSummary({ providerId: 'provider-1' });

    expect(summary.positionCount).toBe(2);
    expect(summary.quantityTotalsByCurrency.ILS).toBe(5);
    expect(summary.valuationTotalsByCurrency.ILS).toBe(70);
    expect(summary.hardFactOnly).toBe(true);
  });

  it('lists holdings positions with filtering', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const api = new FinancialStateApi(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      holding({ id: 'h1', securityId: 'AAA', quantity: 2, currency: 'ILS' }),
      holding({ id: 'h2', securityId: 'BBB', quantity: 3, currency: 'USD', securityName: 'BBB Ltd' }),
    ]);

    const usd = await api.listTotalHoldingsPositions({ providerId: 'provider-1', currency: 'USD' });
    expect(usd).toHaveLength(1);
    expect(usd[0]?.securityId).toBe('BBB');

    const bbb = await api.listTotalHoldingsPositions({ providerId: 'provider-1', securityId: 'BBB' });
    expect(bbb).toHaveLength(1);
    expect(bbb[0]?.currency).toBe('USD');
  });
});
