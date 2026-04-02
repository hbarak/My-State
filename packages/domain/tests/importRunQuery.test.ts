import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { AccountService } from '../src/services/AccountService';
import { PsagotApiImportHandler } from '../src/services/PsagotApiImportHandler';
import { PsagotApiSyncService } from '../src/services/PsagotApiSyncService';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import { ImportRunQueryService } from '../src/services/ImportRunQueryService';
import type { Account, Provider, ProviderIntegration, ProviderMappingProfile, RawImportRow } from '../src/types';

class InMemoryStore implements JsonStore {
  private readonly mem = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.mem.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeHoldingsFixture() {
  const repository = new LocalPortfolioRepository(new InMemoryStore());
  const importService = new PortfolioImportService(repository);
  const queryService = new ImportRunQueryService(repository);

  const provider: Provider = {
    id: 'provider-psagot',
    name: 'Psagot',
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const integration: ProviderIntegration = {
    id: 'integration-psagot-holdings',
    providerId: provider.id,
    kind: 'document',
    dataDomain: 'holdings',
    communicationMethod: 'document_csv',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'psagot.holdings.csv.v1',
    isEnabled: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const profile: ProviderMappingProfile = {
    id: 'profile-psagot-v1',
    providerId: provider.id,
    providerIntegrationId: integration.id,
    name: 'Psagot Holdings CSV v1',
    version: 1,
    isActive: true,
    inputFormat: 'csv',
    fieldMappings: {
      securityId: 'SecurityId',
      securityName: 'Name',
      actionType: 'ActionType',
      quantity: 'Qty',
      costBasis: 'CostBasis',
      currency: 'Currency',
      actionDate: 'ActionDate',
      currentPrice: 'CurrentPrice',
    },
    requiredCanonicalFields: ['securityId', 'securityName', 'actionType', 'quantity', 'costBasis', 'currency', 'actionDate'],
    optionalCanonicalFields: ['currentPrice'],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  async function seed() {
    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);
  }

  return { repository, importService, queryService, provider, integration, profile, seed };
}

const HOLDINGS_CSV = [
  'SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate,CurrentPrice',
  '1084128,Delek Group,Buy,5,100,ILS,15/01/2026,120',
  '1084128,Delek Group,Buy,3,110,ILS,10/02/2026,120',
  '5554321,Teva,Buy,10,50,ILS,01/03/2026,55',
].join('\n');

const HOLDINGS_CSV_WITH_INVALID = [
  'SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate,CurrentPrice',
  '1084128,Delek Group,Buy,5,100,ILS,15/01/2026,120',
  '9999999,Bad Row,Buy,0,50,ILS,01/01/2026,10', // quantity 0 → invalid
].join('\n');

describe('ImportRunQueryService', () => {
  it('returns run summary with correct raw row counts after holdings import', async () => {
    const { importService, queryService, provider, integration, seed } = makeHoldingsFixture();
    await seed();

    const commitResult = await importService.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'psagot-jan.csv',
      csvText: HOLDINGS_CSV,
    });

    const summary = await queryService.getRunSummary(commitResult.importRun.id);

    expect(summary).not.toBeNull();
    expect(summary!.run.id).toBe(commitResult.importRun.id);
    expect(summary!.run.status).toBe('success');
    expect(summary!.rawRowCounts.total).toBe(3);
    expect(summary!.rawRowCounts.valid).toBe(3);
    expect(summary!.rawRowCounts.invalid).toBe(0);
    expect(summary!.lotCount).toBe(3); // 2 Delek lots + 1 Teva lot
    expect(summary!.tradeCount).toBe(0); // holdings import, no trades
  });

  it('returns lot records queryable by run', async () => {
    const { importService, queryService, provider, integration, seed } = makeHoldingsFixture();
    await seed();

    const commitResult = await importService.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'psagot-jan.csv',
      csvText: HOLDINGS_CSV,
    });

    const lots = await queryService.listLotsForRun(commitResult.importRun.id);

    expect(lots).toHaveLength(3);
    const delekLots = lots.filter((l) => l.securityId === '1084128');
    expect(delekLots).toHaveLength(2);
    expect(delekLots.map((l) => l.quantity).sort()).toEqual([3, 5]);

    const tevaLots = lots.filter((l) => l.securityId === '5554321');
    expect(tevaLots).toHaveLength(1);
    expect(tevaLots[0]!.quantity).toBe(10);
  });

  it('isolates lots between different runs', async () => {
    const { importService, queryService, provider, integration, seed } = makeHoldingsFixture();
    await seed();

    const csv1 = [
      'SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate,CurrentPrice',
      '1084128,Delek Group,Buy,5,100,ILS,15/01/2026,120',
    ].join('\n');

    const csv2 = [
      'SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate,CurrentPrice',
      '5554321,Teva,Buy,10,50,ILS,01/03/2026,55',
    ].join('\n');

    const run1 = await importService.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'psagot-jan.csv',
      csvText: csv1,
    });

    const run2 = await importService.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'psagot-feb.csv',
      csvText: csv2,
    });

    const lots1 = await queryService.listLotsForRun(run1.importRun.id);
    const lots2 = await queryService.listLotsForRun(run2.importRun.id);

    expect(lots1).toHaveLength(1);
    expect(lots1[0]!.securityId).toBe('1084128');

    expect(lots2).toHaveLength(1);
    expect(lots2[0]!.securityId).toBe('5554321');
  });

  it('counts invalid rows separately in summary', async () => {
    const { importService, queryService, provider, integration, seed } = makeHoldingsFixture();
    await seed();

    const commitResult = await importService.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'psagot-mixed.csv',
      csvText: HOLDINGS_CSV_WITH_INVALID,
    });

    const summary = await queryService.getRunSummary(commitResult.importRun.id);

    expect(summary).not.toBeNull();
    expect(summary!.rawRowCounts.total).toBe(2);
    expect(summary!.rawRowCounts.valid).toBe(1);
    expect(summary!.rawRowCounts.invalid).toBe(1);
    expect(summary!.lotCount).toBe(1); // only the valid Delek lot
  });

  it('returns null for unknown run id', async () => {
    const { queryService, seed } = makeHoldingsFixture();
    await seed();

    const summary = await queryService.getRunSummary('nonexistent-run');
    expect(summary).toBeNull();
  });

  // ── S5-DEV-03: listAllRuns extensions ──

  it('S5-list-1: listAllRuns returns all runs with correct sourceType, accountLabel, and rawRowCounts', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const importService = new PortfolioImportService(repository);
    const queryService = new ImportRunQueryService(repository);
    const accountService = new AccountService(repository);
    const handler = new PsagotApiImportHandler();
    const syncService = new PsagotApiSyncService(repository, accountService, handler);

    // CSV integration (document_csv)
    const csvProvider: Provider = {
      id: 'prov-csv',
      name: 'CSV Provider',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const csvIntegration: ProviderIntegration = {
      id: 'int-csv',
      providerId: csvProvider.id,
      kind: 'document',
      dataDomain: 'holdings',
      communicationMethod: 'document_csv',
      syncMode: 'manual',
      direction: 'ingest',
      adapterKey: 'psagot.holdings.csv.v1',
      isEnabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const csvProfile: ProviderMappingProfile = {
      id: 'profile-csv',
      providerId: csvProvider.id,
      providerIntegrationId: csvIntegration.id,
      name: 'CSV Profile v1',
      version: 1,
      isActive: true,
      inputFormat: 'csv',
      fieldMappings: {
        securityId: 'SecurityId',
        securityName: 'Name',
        actionType: 'ActionType',
        quantity: 'Qty',
        costBasis: 'CostBasis',
        currency: 'Currency',
        actionDate: 'ActionDate',
      },
      requiredCanonicalFields: ['securityId', 'securityName', 'actionType', 'quantity', 'costBasis', 'currency', 'actionDate'],
      optionalCanonicalFields: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    // API integration (api_pull)
    const apiProvider: Provider = {
      id: 'prov-api',
      name: 'API Provider',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const apiIntegration: ProviderIntegration = {
      id: 'int-api',
      providerId: apiProvider.id,
      kind: 'api',
      dataDomain: 'holdings',
      communicationMethod: 'api_pull',
      syncMode: 'manual',
      direction: 'ingest',
      adapterKey: 'psagot.api.v1',
      isEnabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    // Account for API provider
    const apiAccount: Account = {
      id: 'acc-api-1',
      providerId: apiProvider.id,
      name: 'My API Account',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await repository.upsertProvider(csvProvider);
    await repository.upsertIntegration(csvIntegration);
    await repository.upsertMappingProfile(csvProfile);
    await repository.upsertProvider(apiProvider);
    await repository.upsertIntegration(apiIntegration);
    await repository.upsertAccount(apiAccount);

    // Commit one CSV import
    const csv = [
      'SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate',
      '1111,Stock A,Buy,10,100,ILS,01/01/2026',
    ].join('\n');
    const csvResult = await importService.commitImport({
      providerId: csvProvider.id,
      providerIntegrationId: csvIntegration.id,
      sourceName: 'test.csv',
      csvText: csv,
    });

    // Run one API sync
    const apiResult = await syncService.syncAccount({
      balances: [{
        equityNumber: '2222',
        quantity: 50,
        lastRate: 100,
        averagePrice: 90,
        marketValue: 5000,
        marketValueNis: 5000,
        profitLoss: 500,
        profitLossNis: 500,
        profitLossPct: 10,
        portfolioWeight: 100,
        currencyCode: 'ILS',
        source: 'TA',
        subAccount: '0',
        hebName: 'Test Stock',
      }],
      providerId: apiProvider.id,
      providerIntegrationId: apiIntegration.id,
      accountId: apiAccount.id,
      securityInfoMap: new Map(),
    });

    const allRuns = await queryService.listAllRuns();

    expect(allRuns).toHaveLength(2);

    const csvItem = allRuns.find((r) => r.run.id === csvResult.importRun.id);
    expect(csvItem).toBeDefined();
    expect(csvItem!.sourceType).toBe('csv');
    expect(csvItem!.rawRowCounts).not.toBeNull();
    expect(csvItem!.rawRowCounts!.total).toBe(1);
    expect(csvItem!.rawRowCounts!.valid).toBe(1);

    const apiItem = allRuns.find((r) => r.run.id === apiResult.importRun.id);
    expect(apiItem).toBeDefined();
    expect(apiItem!.sourceType).toBe('api');
    expect(apiItem!.accountLabel).toBe('My API Account');
    expect(apiItem!.rawRowCounts).not.toBeNull();
    expect(apiItem!.rawRowCounts!.total).toBe(1);
    expect(apiItem!.rawRowCounts!.valid).toBe(1);
  });

  it('S5-list-2: listAllRuns sorts runs by startedAt descending (newest first)', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const importService = new PortfolioImportService(repository);
    const queryService = new ImportRunQueryService(repository);

    const provider: Provider = {
      id: 'prov-sort',
      name: 'Sort Provider',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const integration: ProviderIntegration = {
      id: 'int-sort',
      providerId: provider.id,
      kind: 'document',
      dataDomain: 'holdings',
      communicationMethod: 'document_csv',
      syncMode: 'manual',
      direction: 'ingest',
      adapterKey: 'psagot.holdings.csv.v1',
      isEnabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const profile: ProviderMappingProfile = {
      id: 'profile-sort',
      providerId: provider.id,
      providerIntegrationId: integration.id,
      name: 'Sort Profile',
      version: 1,
      isActive: true,
      inputFormat: 'csv',
      fieldMappings: {
        securityId: 'SecurityId',
        securityName: 'Name',
        actionType: 'ActionType',
        quantity: 'Qty',
        costBasis: 'CostBasis',
        currency: 'Currency',
        actionDate: 'ActionDate',
      },
      requiredCanonicalFields: ['securityId', 'securityName', 'actionType', 'quantity', 'costBasis', 'currency', 'actionDate'],
      optionalCanonicalFields: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    const csv1 = ['SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate', '1111,A,Buy,1,10,ILS,01/01/2026'].join('\n');
    const csv2 = ['SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate', '2222,B,Buy,2,20,ILS,01/02/2026'].join('\n');

    const run1 = await importService.commitImport({
      providerId: provider.id, providerIntegrationId: integration.id, sourceName: 'first.csv', csvText: csv1,
    });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    const run2 = await importService.commitImport({
      providerId: provider.id, providerIntegrationId: integration.id, sourceName: 'second.csv', csvText: csv2,
    });

    const allRuns = await queryService.listAllRuns();

    expect(allRuns).toHaveLength(2);
    // Newest first
    expect(allRuns[0]!.run.id).toBe(run2.importRun.id);
    expect(allRuns[1]!.run.id).toBe(run1.importRun.id);
  });

  it('S5-list-3: listRawRowsForRun returns raw rows for the given run', async () => {
    const { importService, queryService, provider, integration, seed } = makeHoldingsFixture();
    await seed();

    const commitResult = await importService.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'rows-test.csv',
      csvText: HOLDINGS_CSV,
    });

    const rawRows = await queryService.listRawRowsForRun(commitResult.importRun.id);

    expect(rawRows).toHaveLength(3);
    for (const row of rawRows) {
      expect(row.importRunId).toBe(commitResult.importRun.id);
    }
  });

  it('S5-list-4: listAllRuns returns null rawRowCounts for legacy runs without raw rows', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const queryService = new ImportRunQueryService(repository);

    const integration: ProviderIntegration = {
      id: 'int-legacy',
      providerId: 'prov-legacy',
      kind: 'document',
      dataDomain: 'holdings',
      communicationMethod: 'document_csv',
      syncMode: 'manual',
      direction: 'ingest',
      adapterKey: 'psagot.holdings.csv.v1',
      isEnabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await repository.upsertIntegration(integration);

    // Insert a legacy run with no raw rows
    await repository.addImportRun({
      id: 'legacy-run-1',
      providerId: 'prov-legacy',
      providerIntegrationId: 'int-legacy',
      sourceName: 'legacy.csv',
      status: 'success',
      startedAt: '2025-01-01T00:00:00.000Z',
      importedCount: 5,
      skippedCount: 0,
      errorCount: 0,
      isUndoable: false,
    });

    const allRuns = await queryService.listAllRuns();

    expect(allRuns).toHaveLength(1);
    expect(allRuns[0]!.rawRowCounts).toBeNull();
    expect(allRuns[0]!.sourceType).toBe('csv');
  });
});
