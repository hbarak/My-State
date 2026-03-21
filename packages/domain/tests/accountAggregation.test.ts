import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { TotalHoldingsStateBuilder } from '../src/services/TotalHoldingsStateBuilder';
import { SecurityLotQueryService } from '../src/services/SecurityLotQueryService';
import { AccountService } from '../src/services/AccountService';
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
    accountId: 'default',
    securityId: 'AAA',
    securityName: 'AAA Corp',
    actionType: 'Buy',
    quantity: 10,
    costBasis: 100,
    currency: 'ILS',
    actionDate: '2026-01-15',
    currentPrice: 120,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Aggregation — Account Awareness (S3-DEV-04)', () => {
  describe('TotalHoldingsStateBuilder — accountIds', () => {
    // AG1: Same security in accounts A and B -> one position, quantity = sum, accountIds: ["A","B"]
    it('AG1: cross-account position has combined quantity and accountIds', async () => {
      const repository = new LocalPortfolioRepository(new InMemoryStore());
      const builder = new TotalHoldingsStateBuilder(repository);

      await repository.addImportRun(run({ id: 'run-1' }));
      await repository.upsertHoldingRecords([
        lot({ id: 'lot-a1', accountId: 'account-a', securityId: 'AAA', quantity: 10, costBasis: 100 }),
        lot({ id: 'lot-b1', accountId: 'account-b', securityId: 'AAA', quantity: 5, costBasis: 110 }),
      ]);

      const state = await builder.build({ providerId: 'provider-1' });

      expect(state.positions).toHaveLength(1);
      const pos = state.positions[0];
      expect(pos.quantity).toBe(15);
      expect(pos.accountIds).toEqual(['account-a', 'account-b']);
    });

    // AG2: Single-account security -> accountIds has one entry
    it('AG2: single-account position has one accountId', async () => {
      const repository = new LocalPortfolioRepository(new InMemoryStore());
      const builder = new TotalHoldingsStateBuilder(repository);

      await repository.addImportRun(run({ id: 'run-1' }));
      await repository.upsertHoldingRecords([
        lot({ id: 'lot-1', accountId: 'only-account', securityId: 'BBB', quantity: 20 }),
      ]);

      const state = await builder.build({ providerId: 'provider-1' });
      expect(state.positions[0].accountIds).toEqual(['only-account']);
    });
  });

  describe('SecurityLotQueryService — accountBreakdown', () => {
    // AG3: accountBreakdown has correct per-account subtotals
    it('AG3: accountBreakdown has correct per-account quantity, totalCost, avgCost, lotCount', async () => {
      const repository = new LocalPortfolioRepository(new InMemoryStore());
      const lotQuery = new SecurityLotQueryService(repository);
      const accountService = new AccountService(repository);

      await repository.addImportRun(run({ id: 'run-1' }));
      await accountService.createAccount({ id: 'joint', providerId: 'provider-1', name: 'Joint Account' });
      await accountService.createAccount({ id: 'ira', providerId: 'provider-1', name: 'IRA Account' });

      await repository.upsertHoldingRecords([
        lot({ id: 'lot-j1', accountId: 'joint', securityId: 'AAA', quantity: 10, costBasis: 100 }),
        lot({ id: 'lot-j2', accountId: 'joint', securityId: 'AAA', quantity: 5, costBasis: 120, actionDate: '2026-02-01' }),
        lot({ id: 'lot-i1', accountId: 'ira', securityId: 'AAA', quantity: 20, costBasis: 90 }),
      ]);

      const position = await lotQuery.getSecurityLots({ providerId: 'provider-1', securityId: 'AAA' });

      expect(position).not.toBeNull();
      expect(position!.accountBreakdown).toHaveLength(2);

      const joint = position!.accountBreakdown.find((b) => b.accountId === 'joint')!;
      expect(joint.accountName).toBe('Joint Account');
      expect(joint.quantity).toBe(15);
      expect(joint.totalCost).toBe(10 * 100 + 5 * 120); // 1600
      expect(joint.weightedAvgCostBasis).toBeCloseTo(1600 / 15);
      expect(joint.lotCount).toBe(2);

      const ira = position!.accountBreakdown.find((b) => b.accountId === 'ira')!;
      expect(ira.accountName).toBe('IRA Account');
      expect(ira.quantity).toBe(20);
      expect(ira.totalCost).toBe(1800);
      expect(ira.lotCount).toBe(1);
    });

    // AG4: accountBreakdown lots are only the lots for that account
    it('AG4: accountBreakdown lots contain only that accounts lots', async () => {
      const repository = new LocalPortfolioRepository(new InMemoryStore());
      const lotQuery = new SecurityLotQueryService(repository);
      const accountService = new AccountService(repository);

      await repository.addImportRun(run({ id: 'run-1' }));
      await accountService.createAccount({ id: 'a', providerId: 'provider-1', name: 'A' });
      await accountService.createAccount({ id: 'b', providerId: 'provider-1', name: 'B' });

      await repository.upsertHoldingRecords([
        lot({ id: 'lot-a', accountId: 'a', securityId: 'XXX', quantity: 10 }),
        lot({ id: 'lot-b', accountId: 'b', securityId: 'XXX', quantity: 20, actionDate: '2026-02-01' }),
      ]);

      const position = await lotQuery.getSecurityLots({ providerId: 'provider-1', securityId: 'XXX' });
      const breakdownA = position!.accountBreakdown.find((b) => b.accountId === 'a')!;
      const breakdownB = position!.accountBreakdown.find((b) => b.accountId === 'b')!;

      expect(breakdownA.lots).toHaveLength(1);
      expect(breakdownA.lots[0].recordId).toBe('lot-a');

      expect(breakdownB.lots).toHaveLength(1);
      expect(breakdownB.lots[0].recordId).toBe('lot-b');
    });

    // AG5: FIFO order is global across accounts within the position
    it('AG5: FIFO order is global across accounts', async () => {
      const repository = new LocalPortfolioRepository(new InMemoryStore());
      const lotQuery = new SecurityLotQueryService(repository);
      const accountService = new AccountService(repository);

      await repository.addImportRun(run({ id: 'run-1' }));
      await accountService.createAccount({ id: 'a', providerId: 'provider-1', name: 'A' });
      await accountService.createAccount({ id: 'b', providerId: 'provider-1', name: 'B' });

      await repository.upsertHoldingRecords([
        lot({ id: 'lot-b1', accountId: 'b', securityId: 'YYY', quantity: 5, actionDate: '2026-01-01' }),
        lot({ id: 'lot-a1', accountId: 'a', securityId: 'YYY', quantity: 10, actionDate: '2026-02-01' }),
        lot({ id: 'lot-b2', accountId: 'b', securityId: 'YYY', quantity: 3, actionDate: '2026-03-01' }),
      ]);

      const position = await lotQuery.getSecurityLots({ providerId: 'provider-1', securityId: 'YYY' });

      // Global FIFO: lot-b1 (Jan) -> lot-a1 (Feb) -> lot-b2 (Mar)
      expect(position!.lots[0].recordId).toBe('lot-b1');
      expect(position!.lots[0].fifoOrder).toBe(1);
      expect(position!.lots[1].recordId).toBe('lot-a1');
      expect(position!.lots[1].fifoOrder).toBe(2);
      expect(position!.lots[2].recordId).toBe('lot-b2');
      expect(position!.lots[2].fifoOrder).toBe(3);
    });

    // AG6: Account with 0 active lots -> not included in accountBreakdown
    it('AG6: accounts with all soft-deleted lots excluded from breakdown', async () => {
      const repository = new LocalPortfolioRepository(new InMemoryStore());
      const lotQuery = new SecurityLotQueryService(repository);
      const accountService = new AccountService(repository);

      await repository.addImportRun(run({ id: 'run-1' }));
      await accountService.createAccount({ id: 'active', providerId: 'provider-1', name: 'Active' });
      await accountService.createAccount({ id: 'empty', providerId: 'provider-1', name: 'Empty' });

      await repository.upsertHoldingRecords([
        lot({ id: 'lot-active', accountId: 'active', securityId: 'ZZZ', quantity: 10 }),
        // soft-deleted lot in "empty" account
        lot({ id: 'lot-deleted', accountId: 'empty', securityId: 'ZZZ', quantity: 5, deletedAt: '2026-02-01T00:00:00.000Z' }),
      ]);

      const position = await lotQuery.getSecurityLots({ providerId: 'provider-1', securityId: 'ZZZ' });

      expect(position!.accountBreakdown).toHaveLength(1);
      expect(position!.accountBreakdown[0].accountId).toBe('active');
    });

    // AG7: accountName in AccountSubtotal matches the Account entity's name
    it('AG7: accountName matches Account entity name', async () => {
      const repository = new LocalPortfolioRepository(new InMemoryStore());
      const lotQuery = new SecurityLotQueryService(repository);
      const accountService = new AccountService(repository);

      await repository.addImportRun(run({ id: 'run-1' }));
      await accountService.createAccount({ id: 'my-acct', providerId: 'provider-1', name: 'My Special Account' });

      await repository.upsertHoldingRecords([
        lot({ id: 'lot-1', accountId: 'my-acct', securityId: 'QQQ', quantity: 10 }),
      ]);

      const position = await lotQuery.getSecurityLots({ providerId: 'provider-1', securityId: 'QQQ' });

      expect(position!.accountBreakdown[0].accountName).toBe('My Special Account');
    });
  });

  // XC4: Single-account data produces identical results to pre-multi-account behavior
  it('XC4: single-account produces same totals as before multi-account', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const builder = new TotalHoldingsStateBuilder(repository);
    const lotQuery = new SecurityLotQueryService(repository);
    const accountService = new AccountService(repository);

    await repository.addImportRun(run({ id: 'run-1' }));
    await accountService.createAccount({ id: 'default', providerId: 'provider-1', name: 'Default' });

    await repository.upsertHoldingRecords([
      lot({ id: 'lot-1', accountId: 'default', securityId: 'AAA', quantity: 10, costBasis: 100, currentPrice: 120 }),
      lot({ id: 'lot-2', accountId: 'default', securityId: 'AAA', quantity: 5, costBasis: 110, currentPrice: 120, actionDate: '2026-02-01' }),
    ]);

    const state = await builder.build({ providerId: 'provider-1' });
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].quantity).toBe(15);
    expect(state.positions[0].accountIds).toEqual(['default']);

    const position = await lotQuery.getSecurityLots({ providerId: 'provider-1', securityId: 'AAA' });
    expect(position!.totalQuantity).toBe(15);
    expect(position!.accountBreakdown).toHaveLength(1);
    expect(position!.accountBreakdown[0].quantity).toBe(15);
  });
});
