import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { SecurityLotQueryService } from '../src/services/SecurityLotQueryService';
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

function lot(overrides: Partial<ProviderHoldingRecord>): ProviderHoldingRecord {
  return {
    id: 'lot-default',
    providerId: 'provider-1',
    providerIntegrationId: 'integration-1',
    importRunId: 'run-1',
    securityId: '1084128',
    securityName: 'Delek Group',
    actionType: 'Buy',
    quantity: 5,
    costBasis: 100,
    currency: 'ILS',
    actionDate: '2026-01-15',
    currentPrice: 120,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SecurityLotQueryService', () => {
  it('returns individual lots for a security ordered by actionDate (FIFO)', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new SecurityLotQueryService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      lot({ id: 'lot-3', actionDate: '2026-03-01', quantity: 10, costBasis: 130 }),
      lot({ id: 'lot-1', actionDate: '2026-01-15', quantity: 5, costBasis: 100 }),
      lot({ id: 'lot-2', actionDate: '2026-02-10', quantity: 3, costBasis: 110 }),
    ]);

    const position = await service.getSecurityLots({ providerId: 'provider-1', securityId: '1084128' });

    expect(position).not.toBeNull();
    expect(position!.lots).toHaveLength(3);
    // FIFO order: oldest first
    expect(position!.lots[0].fifoOrder).toBe(1);
    expect(position!.lots[0].actionDate).toBe('2026-01-15');
    expect(position!.lots[0].quantity).toBe(5);
    expect(position!.lots[1].fifoOrder).toBe(2);
    expect(position!.lots[1].actionDate).toBe('2026-02-10');
    expect(position!.lots[2].fifoOrder).toBe(3);
    expect(position!.lots[2].actionDate).toBe('2026-03-01');
  });

  it('aggregates position totals from all lots', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new SecurityLotQueryService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      lot({ id: 'lot-1', quantity: 5, costBasis: 100, currentPrice: 120 }),
      lot({ id: 'lot-2', quantity: 3, costBasis: 110, actionDate: '2026-02-10', currentPrice: 120 }),
    ]);

    const position = await service.getSecurityLots({ providerId: 'provider-1', securityId: '1084128' });

    expect(position!.totalQuantity).toBe(8);
    expect(position!.totalCost).toBe(830); // (5 * 100) + (3 * 110)
    expect(position!.weightedAvgCostBasis).toBeCloseTo(830 / 8);
    expect(position!.currentPrice).toBe(120);
    // unrealizedGain = (120 * 8) - 830 = 960 - 830 = 130
    expect(position!.unrealizedGain).toBe(130);
    expect(position!.lotCount).toBe(2);
  });

  it('returns full portfolio with multiple securities', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new SecurityLotQueryService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      lot({ id: 'lot-1', securityId: '1084128', securityName: 'Delek Group', quantity: 5, costBasis: 100 }),
      lot({ id: 'lot-2', securityId: '1084128', securityName: 'Delek Group', quantity: 3, costBasis: 110, actionDate: '2026-02-10' }),
      lot({ id: 'lot-3', securityId: '5554321', securityName: 'Teva', quantity: 10, costBasis: 50, currentPrice: 55 }),
    ]);

    const view = await service.getPortfolioLots({ providerId: 'provider-1' });

    expect(view.positionCount).toBe(2);
    const delek = view.positions.find((p) => p.securityId === '1084128');
    const teva = view.positions.find((p) => p.securityId === '5554321');
    expect(delek!.lotCount).toBe(2);
    expect(delek!.totalQuantity).toBe(8);
    expect(teva!.lotCount).toBe(1);
    expect(teva!.totalQuantity).toBe(10);
  });

  it('excludes lots from failed/undone runs and deleted records', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new SecurityLotQueryService(repository);

    await repository.addImportRun(run({ id: 'run-ok', status: 'success' }));
    await repository.addImportRun(run({ id: 'run-failed', status: 'failed' }));
    await repository.addImportRun(run({ id: 'run-undone', status: 'success', undoneAt: '2026-03-01T00:00:00.000Z' }));

    await repository.upsertHoldingRecords([
      lot({ id: 'ok', importRunId: 'run-ok', quantity: 5 }),
      lot({ id: 'from-failed', importRunId: 'run-failed', quantity: 10, securityId: '9999' }),
      lot({ id: 'from-undone', importRunId: 'run-undone', quantity: 7, securityId: '8888' }),
      lot({ id: 'deleted', importRunId: 'run-ok', quantity: 3, securityId: '7777', deletedAt: '2026-02-01T00:00:00.000Z' }),
    ]);

    const view = await service.getPortfolioLots({ providerId: 'provider-1' });

    expect(view.positionCount).toBe(1);
    expect(view.positions[0].securityId).toBe('1084128');
    expect(view.positions[0].totalQuantity).toBe(5);
  });

  it('returns null for unknown security', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new SecurityLotQueryService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      lot({ id: 'lot-1', securityId: '1084128' }),
    ]);

    const result = await service.getSecurityLots({ providerId: 'provider-1', securityId: 'nonexistent' });
    expect(result).toBeNull();
  });

  it('marks unrealizedGain as undefined when currentPrice is missing', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new SecurityLotQueryService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      lot({ id: 'lot-1', quantity: 5, costBasis: 100, currentPrice: undefined }),
    ]);

    const position = await service.getSecurityLots({ providerId: 'provider-1', securityId: '1084128' });

    expect(position!.currentPrice).toBeUndefined();
    expect(position!.unrealizedGain).toBeUndefined();
  });

  it('uses FIFO order to identify which lot sells next', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const service = new SecurityLotQueryService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await repository.upsertHoldingRecords([
      lot({ id: 'lot-newest', actionDate: '2026-12-01', quantity: 10, costBasis: 200 }),
      lot({ id: 'lot-oldest', actionDate: '2025-06-01', quantity: 5, costBasis: 80 }),
      lot({ id: 'lot-middle', actionDate: '2026-06-01', quantity: 3, costBasis: 150 }),
    ]);

    const position = await service.getSecurityLots({ providerId: 'provider-1', securityId: '1084128' });

    // "Which lot sells next?" → fifoOrder 1 = oldest
    const nextToSell = position!.lots[0];
    expect(nextToSell.fifoOrder).toBe(1);
    expect(nextToSell.actionDate).toBe('2025-06-01');
    expect(nextToSell.costBasis).toBe(80);
    expect(nextToSell.quantity).toBe(5);
  });
});
