import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import { ImportRunQueryService } from '../src/services/ImportRunQueryService';
import type { Provider, ProviderIntegration, ProviderMappingProfile } from '../src/types';

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
});
