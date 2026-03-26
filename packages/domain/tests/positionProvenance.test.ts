/**
 * S6-DEV-04: Position provenance query tests (AC 3)
 *
 * Tests the new repository method getProvenanceForSecurity(securityId)
 * which returns the list of import runs contributing lots to a position.
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

describe('getProvenanceForSecurity (AC 3)', () => {
  it('AC3-1: single-run position returns one provenance entry', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('AAPL', 'Apple Inc', 10, 15000, '01/01/2026'),
    ].join('\n');

    const run = await service.commitImport(importParams(csv, 'account-a'));

    const provenance = await repository.getProvenanceForSecurity('AAPL');

    expect(provenance).toHaveLength(1);
    expect(provenance[0]!.runId).toBe(run.importRun.id);
    expect(provenance[0]!.importDate).toBeDefined();
    expect(provenance[0]!.accountId).toBe('account-a');
    expect(provenance[0]!.lotCount).toBe(1);
  });

  it('AC3-2: multi-lot single-run position shows correct lotCount', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('MSFT', 'Microsoft', 5, 30000, '01/01/2026'),
      csvRow('MSFT', 'Microsoft', 3, 28000, '15/01/2026'), // same security, 2 lots
    ].join('\n');

    const run = await service.commitImport(importParams(csv, 'account-a'));

    const provenance = await repository.getProvenanceForSecurity('MSFT');

    expect(provenance).toHaveLength(1);
    expect(provenance[0]!.runId).toBe(run.importRun.id);
    expect(provenance[0]!.lotCount).toBe(2);
  });

  it('AC3-3: multi-run position shows all contributing runs', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    // First import — different lots (different costBasis)
    const csvRun1 = [
      CSV_HEADER,
      csvRow('GOOGL', 'Alphabet', 5, 15000, '01/01/2026'),
    ].join('\n');
    const csvRun2 = [
      CSV_HEADER,
      csvRow('GOOGL', 'Alphabet', 5, 15000, '01/01/2026'), // same lot (duplicate)
      csvRow('GOOGL', 'Alphabet', 3, 16000, '15/01/2026'), // new lot
    ].join('\n');

    const run1 = await service.commitImport(importParams(csvRun1, 'account-a'));
    const run2 = await service.commitImport(importParams(csvRun2, 'account-a'));

    const provenance = await repository.getProvenanceForSecurity('GOOGL');

    // Both runs contributed lots to this security
    const runIds = provenance.map((p) => p.runId);
    expect(runIds).toContain(run1.importRun.id);
    expect(runIds).toContain(run2.importRun.id);
  });

  it('AC3-4: soft-deleted lots are excluded from provenance', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('TSLA', 'Tesla', 10, 25000, '01/01/2026'),
    ].join('\n');

    const run = await service.commitImport(importParams(csv));
    await repository.deleteImportRunContribution(run.importRun.id);

    const provenance = await repository.getProvenanceForSecurity('TSLA');
    expect(provenance).toHaveLength(0);
  });

  it('AC3-5: security with no lots returns empty provenance array (no crash)', async () => {
    const { repository, seed } = makeFixture();
    await seed();

    const provenance = await repository.getProvenanceForSecurity('NONEXISTENT');
    expect(provenance).toEqual([]);
  });

  it('AC3-6: provenance for security X does not include lots from security Y', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('AAPL', 'Apple', 10, 15000, '01/01/2026'),
      csvRow('MSFT', 'Microsoft', 5, 30000, '01/01/2026'),
    ].join('\n');

    await service.commitImport(importParams(csv));

    const provenanceAAPL = await repository.getProvenanceForSecurity('AAPL');
    const provenance = provenanceAAPL.flatMap((p) => [p.runId]);

    // Verify provenance entry lot counts only count AAPL lots
    expect(provenanceAAPL[0]!.lotCount).toBe(1);

    const provMSFT = await repository.getProvenanceForSecurity('MSFT');
    expect(provMSFT[0]!.lotCount).toBe(1);
  });

  it('AC3-7: multi-account security provenance shows correct accountId per entry', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csvA = [
      CSV_HEADER,
      csvRow('AAPL', 'Apple', 10, 15000, '01/01/2026'),
    ].join('\n');
    const csvB = [
      CSV_HEADER,
      csvRow('AAPL', 'Apple', 5, 14000, '01/02/2026'),
    ].join('\n');

    const runA = await service.commitImport(importParams(csvA, 'account-a'));
    const runB = await service.commitImport(importParams(csvB, 'account-b'));

    const provenance = await repository.getProvenanceForSecurity('AAPL');

    expect(provenance).toHaveLength(2);
    const byAccount = Object.fromEntries(provenance.map((p) => [p.accountId, p]));
    expect(byAccount['account-a']!.runId).toBe(runA.importRun.id);
    expect(byAccount['account-b']!.runId).toBe(runB.importRun.id);
  });
});
