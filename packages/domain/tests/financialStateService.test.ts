import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { FinancialStateService } from '../src/services/FinancialStateService';
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
    accountId: 'default',
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
    accountId: 'default',
    securityId: 'AAA',
    securityName: 'AAA Corp',
    actionType: 'קניה',
    quantity: 2,
    costBasis: 10,
    currency: 'ILS',
    actionDate: '2026-01-01',
    currentPrice: 15,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FinancialStateService', () => {
  it('returns total holdings state via service contract', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new FinancialStateService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([holding({ id: 'h1', securityId: 'AAA' })]);

    const state = await service.getTotalHoldingsState({ providerId: 'provider-1' });
    expect(state.stateType).toBe('total_holdings');
    expect(state.positionCount).toBe(1);
    expect(state.valuationTotalsByCurrency.ILS).toBe(30);
  });

  it('returns net worth as insufficient_data when cash domain is unavailable', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new FinancialStateService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([holding({ id: 'h1', securityId: 'AAA' })]);

    const netWorth = await service.getNetWorthState({ providerId: 'provider-1' });
    expect(netWorth.stateType).toBe('net_worth');
    expect(netWorth.hardFactOnly).toBe(true);
    expect(netWorth.insufficientData).toBe(true);
    expect(netWorth.holdingsValuationTotalsByCurrency.ILS).toBe(30);
    expect(netWorth.netWorthTotalsByCurrency).toBeUndefined();
    expect(netWorth.notes.join(' ')).toContain('No implicit cash assumptions');
  });
});
