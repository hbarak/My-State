/**
 * S6-DEV-02: deleteImportRunContribution tests (AC 4)
 *
 * Tests the new repository method that soft-deletes all ProviderHoldingRecord
 * rows with a given importRunId, and marks the PortfolioImportRun as undone.
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

describe('deleteImportRunContribution (AC 4)', () => {
  it('AC4-1: soft-deletes all holding records with matching importRunId', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026'),
      csvRow('BBB', 'Stock B', 50, 3000, '15/01/2026'),
    ].join('\n');

    const result = await service.commitImport(importParams(csv));
    const runId = result.importRun.id;

    // Verify lots exist before
    const before = await repository.listHoldingRecordsByAccount('psagot', 'default');
    expect(before).toHaveLength(2);

    await repository.deleteImportRunContribution(runId);

    // Lots should be gone from active view
    const after = await repository.listHoldingRecordsByAccount('psagot', 'default');
    expect(after).toHaveLength(0);
  });

  it('AC4-2: sets deletedAt and updatedAt on soft-deleted records', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    const result = await service.commitImport(importParams(csv));
    const runId = result.importRun.id;

    await repository.deleteImportRunContribution(runId);

    // Raw listHoldingRecordsByImportRun includes soft-deleted records
    const allRecords = await repository.listHoldingRecordsByImportRun(runId);
    expect(allRecords).toHaveLength(1);
    expect(allRecords[0]!.deletedAt).toBeDefined();
    expect(allRecords[0]!.updatedAt).toBeDefined();
  });

  it('AC4-3: marks the PortfolioImportRun as isUndoable: false and sets undoneAt', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    const result = await service.commitImport(importParams(csv));
    const runId = result.importRun.id;

    // Run should be undoable before
    const runsBefore = await repository.listImportRuns();
    const runBefore = runsBefore.find((r) => r.id === runId);
    expect(runBefore!.isUndoable).toBe(true);

    await repository.deleteImportRunContribution(runId);

    const runsAfter = await repository.listImportRuns();
    const runAfter = runsAfter.find((r) => r.id === runId);
    expect(runAfter!.isUndoable).toBe(false);
    expect(runAfter!.undoneAt).toBeDefined();
  });

  it('AC4-4: raw rows are NOT deleted (permanent audit trail)', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026'),
      csvRow('BBB', 'Stock B', 50, 3000, '15/01/2026'),
    ].join('\n');

    const result = await service.commitImport(importParams(csv));
    const runId = result.importRun.id;

    await repository.deleteImportRunContribution(runId);

    const rawRows = await repository.listRawRowsByImportRun(runId);
    expect(rawRows).toHaveLength(2); // raw rows preserved
  });

  it('AC4-5: ticker mappings are NOT deleted', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    // Pre-seed a ticker mapping
    await repository.upsertTickerMapping({
      securityId: 'AAA',
      securityName: 'Stock A',
      ticker: 'AAA.TA',
      resolvedAt: nowIso(),
      resolvedBy: 'auto',
    });

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    const result = await service.commitImport(importParams(csv));

    await repository.deleteImportRunContribution(result.importRun.id);

    const mapping = await repository.getTickerMapping('AAA');
    expect(mapping).not.toBeNull();
    expect(mapping!.ticker).toBe('AAA.TA');
  });

  it('AC4-6: after deletion, re-importing same CSV re-creates lots with new importRunId', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');

    const run1 = await service.commitImport(importParams(csv));
    await repository.deleteImportRunContribution(run1.importRun.id);

    // Verify deleted
    expect(await repository.listHoldingRecordsByAccount('psagot', 'default')).toHaveLength(0);

    // Re-import same CSV
    const run2 = await service.commitImport(importParams(csv));
    const lotsAfter = await repository.listHoldingRecordsByAccount('psagot', 'default');

    expect(lotsAfter).toHaveLength(1);
    expect(lotsAfter[0]!.importRunId).toBe(run2.importRun.id);
    expect(lotsAfter[0]!.importRunId).not.toBe(run1.importRun.id);
  });

  it('AC4-7: deleting run R leaves runs before and after unaffected', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csvR1 = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    const csvR2 = [CSV_HEADER, csvRow('BBB', 'Stock B', 50, 3000, '15/01/2026'), csvRow('CCC', 'Stock C', 25, 2000, '20/01/2026')].join('\n');
    const csvR3 = [CSV_HEADER, csvRow('DDD', 'Stock D', 75, 4000, '01/02/2026')].join('\n');

    const run1 = await service.commitImport(importParams(csvR1, 'account-1'));
    const run2 = await service.commitImport(importParams(csvR2, 'account-2'));
    const run3 = await service.commitImport(importParams(csvR3, 'account-3'));

    // Delete R2 only
    await repository.deleteImportRunContribution(run2.importRun.id);

    const lotsAcc1 = await repository.listHoldingRecordsByAccount('psagot', 'account-1');
    const lotsAcc2 = await repository.listHoldingRecordsByAccount('psagot', 'account-2');
    const lotsAcc3 = await repository.listHoldingRecordsByAccount('psagot', 'account-3');

    expect(lotsAcc1).toHaveLength(1); // R1 unaffected
    expect(lotsAcc2).toHaveLength(0); // R2 deleted
    expect(lotsAcc3).toHaveLength(1); // R3 unaffected
    expect(lotsAcc1[0]!.importRunId).toBe(run1.importRun.id);
    expect(lotsAcc3[0]!.importRunId).toBe(run3.importRun.id);
  });

  it('AC4-8: deleting a run with no active lots is a no-op (no error)', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    const result = await service.commitImport(importParams(csv));

    // Delete once
    await repository.deleteImportRunContribution(result.importRun.id);
    // Delete again — should not throw
    await expect(repository.deleteImportRunContribution(result.importRun.id)).resolves.toBeUndefined();
  });

  it('AC4-9: delete non-existent runId returns cleanly without throwing', async () => {
    const { repository, seed } = makeFixture();
    await seed();

    await expect(repository.deleteImportRunContribution('non-existent-run-id')).resolves.toBeUndefined();
  });
});
