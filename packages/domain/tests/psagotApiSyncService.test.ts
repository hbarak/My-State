import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { AccountService } from '../src/services/AccountService';
import { PsagotApiImportHandler } from '../src/services/PsagotApiImportHandler';
import { PsagotApiSyncService } from '../src/services/PsagotApiSyncService';
import { SecurityLotQueryService } from '../src/services/SecurityLotQueryService';
import type { PsagotBalance, ProviderHoldingRecord } from '../src/types';

class InMemoryStore implements JsonStore {
  private readonly mem = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.mem.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
  }
}

const PROVIDER_ID = 'provider-psagot';
const INTEGRATION_ID = 'psagot-api-holdings';
const ACCOUNT_A = '150-190500';
const ACCOUNT_B = '150-190501';

function makeBalance(overrides: Partial<PsagotBalance> = {}): PsagotBalance {
  return {
    equityNumber: '5130919',
    quantity: 100,
    lastRate: 9741,
    averagePrice: 8500,
    marketValue: 974100,
    marketValueNis: 974100,
    profitLoss: 124100,
    profitLossNis: 124100,
    profitLossPct: 14.6,
    portfolioWeight: 45.2,
    currencyCode: 'ILS',
    source: 'TA',
    subAccount: '0',
    hebName: 'בנק לאומי',
    ...overrides,
  };
}

function makeFixture() {
  const store = new InMemoryStore();
  const repository = new LocalPortfolioRepository(store);
  const accountService = new AccountService(repository);
  const handler = new PsagotApiImportHandler();
  const syncService = new PsagotApiSyncService(repository, accountService, handler);
  const lotQueryService = new SecurityLotQueryService(repository);
  return { store, repository, accountService, handler, syncService, lotQueryService };
}

describe('PsagotApiSyncService', () => {
  // ── P1: API import creates holding records ──
  it('P1: synced positions are visible in repository', async () => {
    const { syncService, repository } = makeFixture();

    await syncService.syncAccount({
      balances: [
        makeBalance({ equityNumber: '111', quantity: 50 }),
        makeBalance({ equityNumber: '222', quantity: 30 }),
      ],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    const records = await repository.listHoldingRecordsByAccount(PROVIDER_ID, ACCOUNT_A);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.securityId).sort()).toEqual(['111', '222']);
  });

  // ── P3: import run created with success status ──
  it('P3: sync creates an import run with status success', async () => {
    const { syncService, repository } = makeFixture();

    const result = await syncService.syncAccount({
      balances: [makeBalance()],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    expect(result.importRun.status).toBe('success');
    expect(result.importRun.importedCount).toBe(1);
    expect(result.importRun.providerId).toBe(PROVIDER_ID);
    expect(result.importRun.providerIntegrationId).toBe(INTEGRATION_ID);

    const runs = await repository.listImportRuns();
    expect(runs).toHaveLength(1);
  });

  // ── P4: import run is undoable ──
  it('P4: sync is undoable — undo soft-deletes records', async () => {
    const { syncService, repository } = makeFixture();

    const result = await syncService.syncAccount({
      balances: [makeBalance()],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    expect(result.importRun.isUndoable).toBe(true);

    await syncService.undoLastSync(INTEGRATION_ID);

    const records = await repository.listHoldingRecordsByAccount(PROVIDER_ID, ACCOUNT_A);
    expect(records).toHaveLength(0);
  });

  // ── P6: API and CSV records coexist ──
  it('P6: API records coexist with CSV records for same provider', async () => {
    const { syncService, repository } = makeFixture();

    // Simulate pre-existing CSV record
    const csvRecord: ProviderHoldingRecord = {
      id: 'csv-rec-1',
      providerId: PROVIDER_ID,
      providerIntegrationId: 'csv-integration',
      accountId: ACCOUNT_A,
      securityId: '5130919',
      securityName: 'בנק לאומי',
      actionType: 'קניה',
      quantity: 50,
      costBasis: 80,
      currency: 'ILS',
      actionDate: '2025-01-15',
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    };
    await repository.upsertHoldingRecords([csvRecord]);

    await syncService.syncAccount({
      balances: [makeBalance({ equityNumber: '5130919', quantity: 100 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    const allRecords = await repository.listHoldingRecordsByProvider(PROVIDER_ID);
    expect(allRecords).toHaveLength(2); // 1 CSV + 1 API
  });

  // ── P7: Re-sync updates existing positions (no duplicates) ──
  it('P7: re-sync updates existing positions, does not duplicate', async () => {
    const { syncService, repository } = makeFixture();

    // First sync: qty=100
    await syncService.syncAccount({
      balances: [makeBalance({ equityNumber: '5130919', quantity: 100 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    // Second sync: qty=95 (sold 5)
    await syncService.syncAccount({
      balances: [makeBalance({ equityNumber: '5130919', quantity: 95 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    const records = await repository.listHoldingRecordsByAccount(PROVIDER_ID, ACCOUNT_A);
    const activeRecords = records.filter((r) => r.providerIntegrationId === INTEGRATION_ID);
    expect(activeRecords).toHaveLength(1);
    expect(activeRecords[0].quantity).toBe(95);
  });

  // ── P8: Empty positions creates run with zero imported ──
  it('P8: empty balances creates run with zero imported', async () => {
    const { syncService } = makeFixture();

    const result = await syncService.syncAccount({
      balances: [],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    expect(result.importRun.status).toBe('success');
    expect(result.importRun.importedCount).toBe(0);
  });

  // ── Removed positions get soft-deleted ──
  it('positions no longer in API response are soft-deleted', async () => {
    const { syncService, repository } = makeFixture();

    // First sync: 2 positions
    await syncService.syncAccount({
      balances: [
        makeBalance({ equityNumber: '111', quantity: 50 }),
        makeBalance({ equityNumber: '222', quantity: 30 }),
      ],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    // Second sync: only 1 position (222 was sold)
    const result = await syncService.syncAccount({
      balances: [makeBalance({ equityNumber: '111', quantity: 50 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    expect(result.removedRecords).toBe(1);

    const active = await repository.listHoldingRecordsByAccount(PROVIDER_ID, ACCOUNT_A);
    const apiRecords = active.filter((r) => r.providerIntegrationId === INTEGRATION_ID);
    expect(apiRecords).toHaveLength(1);
    expect(apiRecords[0].securityId).toBe('111');
  });

  // ── P10: multi-account sync ──
  it('P10: syncAllAccounts syncs multiple accounts in sequence', async () => {
    const { syncService, repository } = makeFixture();

    const summary = await syncService.syncAllAccounts({
      accountBalances: [
        { accountId: ACCOUNT_A, balances: [makeBalance({ equityNumber: '111', quantity: 50 })] },
        { accountId: ACCOUNT_B, balances: [makeBalance({ equityNumber: '222', quantity: 30 })] },
      ],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      agorotConversion: true,
    });

    expect(summary.accountsSynced).toBe(2);
    expect(summary.totalNewRecords).toBe(2);
    expect(summary.errors).toHaveLength(0);

    const recordsA = await repository.listHoldingRecordsByAccount(PROVIDER_ID, ACCOUNT_A);
    const recordsB = await repository.listHoldingRecordsByAccount(PROVIDER_ID, ACCOUNT_B);
    expect(recordsA.filter((r) => r.providerIntegrationId === INTEGRATION_ID)).toHaveLength(1);
    expect(recordsB.filter((r) => r.providerIntegrationId === INTEGRATION_ID)).toHaveLength(1);
  });

  // ── P2: synced positions are queryable via SecurityLotQueryService ──
  it('P2: synced positions are queryable by security via SecurityLotQueryService', async () => {
    const { syncService, lotQueryService } = makeFixture();

    await syncService.syncAccount({
      balances: [makeBalance({ equityNumber: '5130919', quantity: 100 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    const position = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '5130919',
    });

    expect(position).not.toBeNull();
    expect(position?.securityId).toBe('5130919');
  });

  // ── P5: API records carry the api integration id ──
  it('P5: synced records have providerIntegrationId matching the api integration', async () => {
    const { syncService, repository } = makeFixture();

    await syncService.syncAccount({
      balances: [makeBalance({ equityNumber: '5130919' })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    const records = await repository.listHoldingRecordsByAccount(PROVIDER_ID, ACCOUNT_A);
    expect(records).toHaveLength(1);
    expect(records[0].providerIntegrationId).toBe(INTEGRATION_ID);
  });

  // ── P9: raw row audit — import run links to synced records ──
  it('P9: listHoldingRecordsByImportRun returns all records from the sync run', async () => {
    const { syncService, repository } = makeFixture();

    const result = await syncService.syncAccount({
      balances: [
        makeBalance({ equityNumber: '111', quantity: 50 }),
        makeBalance({ equityNumber: '222', quantity: 30 }),
      ],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    const runRecords = await repository.listHoldingRecordsByImportRun(result.importRun.id);
    expect(runRecords).toHaveLength(2);
    expect(runRecords.map((r) => r.securityId).sort()).toEqual(['111', '222']);
  });

  // ── Undo-after-update is destructive (documented behavior) ──
  it('undo after update soft-deletes updated records (undo is destructive for updated positions)', async () => {
    const { syncService, repository } = makeFixture();

    // First sync: create a position
    await syncService.syncAccount({
      balances: [makeBalance({ equityNumber: '5130919', quantity: 100 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    // Second sync: update the same position (quantity changes)
    const result = await syncService.syncAccount({
      balances: [makeBalance({ equityNumber: '5130919', quantity: 95 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    expect(result.updatedRecords).toBe(1);

    // Undo second sync — updated record gets the new runId, so undo soft-deletes it
    await syncService.undoLastSync(INTEGRATION_ID);

    const records = await repository.listHoldingRecordsByAccount(PROVIDER_ID, ACCOUNT_A);
    const apiRecords = records.filter((r) => r.providerIntegrationId === INTEGRATION_ID);
    // Undo is destructive: updated record is soft-deleted, not rolled back to qty=100
    expect(apiRecords).toHaveLength(0);
  });

  // ── syncAllAccounts mid-sequence failure is isolated ──
  it('syncAllAccounts continues after per-account failure and collects error', async () => {
    const { repository, accountService, handler } = makeFixture();

    // Create a syncService whose handler throws on the first account
    let callCount = 0;
    const failingHandler = {
      mapBalancesToHoldingRecords: (params: Parameters<typeof handler.mapBalancesToHoldingRecords>[0]) => {
        callCount++;
        if (callCount === 1) throw { type: 'api_error', message: 'simulated failure' };
        return handler.mapBalancesToHoldingRecords(params);
      },
    } as typeof handler;

    const syncService = new PsagotApiSyncService(repository, accountService, failingHandler);

    const summary = await syncService.syncAllAccounts({
      accountBalances: [
        { accountId: ACCOUNT_A, balances: [makeBalance({ equityNumber: '111' })] },
        { accountId: ACCOUNT_B, balances: [makeBalance({ equityNumber: '222' })] },
      ],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      agorotConversion: true,
    });

    // Account A failed, account B succeeded
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].accountId).toBe(ACCOUNT_A);
    expect(summary.errors[0].error.type).toBe('api_error');
    expect(summary.accountsSynced).toBe(1);
    expect(summary.totalNewRecords).toBe(1);
  });

  // ── Sync summary counts ──
  it('syncAccount returns correct new/updated/removed counts', async () => {
    const { syncService } = makeFixture();

    // First sync
    await syncService.syncAccount({
      balances: [
        makeBalance({ equityNumber: '111', quantity: 50 }),
        makeBalance({ equityNumber: '222', quantity: 30 }),
      ],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    // Second sync: 111 updated, 222 removed, 333 new
    const result = await syncService.syncAccount({
      balances: [
        makeBalance({ equityNumber: '111', quantity: 60 }),
        makeBalance({ equityNumber: '333', quantity: 40 }),
      ],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_A,
      agorotConversion: true,
    });

    expect(result.newRecords).toBe(1);      // 333
    expect(result.updatedRecords).toBe(1);   // 111
    expect(result.removedRecords).toBe(1);   // 222
  });
});
