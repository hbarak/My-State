/**
 * S6-DEV-05: Dev reset tests (AC 5)
 *
 * Tests the new resetAllData() repository method that wipes all holding
 * records, import runs, raw rows, and ticker mappings.
 */
import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
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

const CSV_HEADER = 'SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate';

function csvRow(securityId: string, name: string, qty: number, costBasis: number, date: string): string {
  return `${securityId},${name},Buy,${qty},${costBasis},ILS,${date}`;
}

function makeFixture() {
  const store = new InMemoryStore();
  const repository = new LocalPortfolioRepository(store);
  const service = new PortfolioImportService(repository);

  const provider: Provider = {
    id: 'psagot',
    name: 'Psagot',
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const integration: ProviderIntegration = {
    id: 'psagot-holdings-csv',
    providerId: 'psagot',
    kind: 'document',
    dataDomain: 'holdings',
    communicationMethod: 'document_csv',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'csv.holdings.v1',
    isEnabled: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const profile: ProviderMappingProfile = {
    id: 'psagot-holdings-v1',
    providerId: 'psagot',
    providerIntegrationId: 'psagot-holdings-csv',
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
    },
    requiredCanonicalFields: [
      'securityId',
      'securityName',
      'actionType',
      'quantity',
      'costBasis',
      'currency',
      'actionDate',
    ],
    optionalCanonicalFields: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  async function seed() {
    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);
  }

  const importParams = (csvText: string, accountId: string = 'default') => ({
    providerId: 'psagot',
    providerIntegrationId: 'psagot-holdings-csv',
    sourceName: 'test.csv',
    csvText,
    accountId,
  });

  return { repository, service, seed, importParams };
}

describe('resetAllData (AC 5)', () => {
  it('AC5-1: after reset, listHoldingRecords returns empty', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    await service.commitImport(importParams(csv));

    const before = await repository.listHoldingRecords();
    expect(before.length).toBeGreaterThan(0);

    await repository.resetAllData();

    const after = await repository.listHoldingRecords();
    expect(after).toHaveLength(0);
  });

  it('AC5-2: after reset, listImportRuns returns empty', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    await service.commitImport(importParams(csv));

    await repository.resetAllData();

    const runs = await repository.listImportRuns();
    expect(runs).toHaveLength(0);
  });

  it('AC5-3: after reset, listTickerMappings returns empty', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    await repository.upsertTickerMapping({
      securityId: 'AAA',
      securityName: 'Stock A',
      ticker: 'AAA.TA',
      resolvedAt: nowIso(),
      resolvedBy: 'auto',
    });

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    await service.commitImport(importParams(csv));

    await repository.resetAllData();

    const mappings = await repository.listTickerMappings();
    expect(mappings).toHaveLength(0);
  });

  it('AC5-4: after reset and re-import, import runs normally with no leftover dedup interference', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026'),
      csvRow('BBB', 'Stock B', 50, 3000, '15/01/2026'),
    ].join('\n');

    await service.commitImport(importParams(csv));
    await repository.resetAllData();

    // Re-import should work cleanly — no duplicate detection from old data
    const result = await service.commitImport(importParams(csv));
    expect(result.importedTrades).toBe(2);
    expect(result.skippedRows).toBe(0);

    const lots = await repository.listHoldingRecords();
    expect(lots).toHaveLength(2);
  });

  it('AC5-5: reset with zero data does not throw', async () => {
    const { repository } = makeFixture();
    await expect(repository.resetAllData()).resolves.toBeUndefined();
  });

  it('AC5-6: reset clears raw rows', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    const result = await service.commitImport(importParams(csv));
    const runId = result.importRun.id;

    const rawBefore = await repository.listRawRowsByImportRun(runId);
    expect(rawBefore.length).toBeGreaterThan(0);

    await repository.resetAllData();

    const rawAfter = await repository.listRawRowsByImportRun(runId);
    expect(rawAfter).toHaveLength(0);
  });

  it('AC5-7: provider, integration, and mapping profile config are preserved after reset', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    await service.commitImport(importParams(csv));

    await repository.resetAllData();

    // Configuration data should survive — only import data is cleared
    const providers = await repository.getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.id).toBe('psagot');

    const profile = await repository.getActiveMappingProfile('psagot-holdings-csv');
    expect(profile).not.toBeNull();
  });
});
