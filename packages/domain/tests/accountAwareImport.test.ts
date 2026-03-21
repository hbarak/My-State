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

const CSV_HEADER = 'מספר ני"ע,שם ני"ע,סוג פעולה,כמות,שער עלות,מטבע,תאריך פעולה,שער נוכחי';

function csvRow(securityId: string, name: string, qty: number, costBasis: number, date: string, price: number = 100): string {
  return `${securityId},${name},קניה,${qty},${costBasis},ש"ח,${date},${price}`;
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
      securityId: 'מספר ני"ע',
      securityName: 'שם ני"ע',
      actionType: 'סוג פעולה',
      quantity: 'כמות',
      costBasis: 'שער עלות',
      currency: 'מטבע',
      actionDate: 'תאריך פעולה',
      currentPrice: 'שער נוכחי',
    },
    requiredCanonicalFields: ['securityId', 'securityName', 'actionType', 'quantity', 'costBasis', 'currency', 'actionDate'],
    parsingRules: {
      monetaryUnit: 'agorot',
    },
  };

  return { store, repository, service, provider, integration, profile };
}

async function seedFixture(fixture: ReturnType<typeof makeFixture>) {
  await fixture.repository.upsertProvider(fixture.provider);
  await fixture.repository.upsertIntegration(fixture.integration);
  await fixture.repository.upsertMappingProfile(fixture.profile);
}

const importParams = (csvText: string, accountId: string) => ({
  providerId: 'psagot',
  providerIntegrationId: 'psagot-holdings-csv',
  sourceName: 'test.csv',
  csvText,
  accountId,
});

const previewParams = (csvText: string, accountId: string) => ({
  providerId: 'psagot',
  providerIntegrationId: 'psagot-holdings-csv',
  csvText,
  accountId,
});

describe('Account-Aware Import Pipeline (S3-DEV-03)', () => {
  // IM1: previewImport with accountId -> all normalized records have that accountId stamped
  it('IM1: preview stamps accountId on all normalized records', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csv = [CSV_HEADER, csvRow('AAA', 'AAA Corp', 100, 5000, '01/01/2026')].join('\n');

    const preview = await fixture.service.previewImport(previewParams(csv, 'joint'));

    expect(preview.validRows).toHaveLength(1);
    const normalized = preview.validRows[0].normalized as { accountId: string };
    expect(normalized.accountId).toBe('joint');
  });

  // IM2: commitImport with accountId -> persisted records have accountId, import run has accountId
  it('IM2: commit persists accountId on records and import run', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csv = [CSV_HEADER, csvRow('BBB', 'BBB Corp', 50, 2000, '15/02/2026')].join('\n');

    const result = await fixture.service.commitImport(importParams(csv, 'ira'));

    expect(result.importRun.accountId).toBe('ira');

    const records = await fixture.repository.listHoldingRecordsByAccount('psagot', 'ira');
    expect(records).toHaveLength(1);
    expect(records[0].accountId).toBe('ira');
  });

  // IM3: Import same CSV into account A then account B -> creates separate record sets
  it('IM3: same CSV into different accounts creates separate records', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csv = [CSV_HEADER, csvRow('CCC', 'CCC Corp', 200, 8000, '10/03/2026')].join('\n');

    await fixture.service.commitImport(importParams(csv, 'account-a'));
    await fixture.service.commitImport(importParams(csv, 'account-b'));

    const recordsA = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-a');
    const recordsB = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-b');

    expect(recordsA).toHaveLength(1);
    expect(recordsB).toHaveLength(1);
    expect(recordsA[0].id).not.toBe(recordsB[0].id);
  });

  // IM4: Re-import for account A -> only account A records participate in dedup
  it('IM4: re-import dedup scoped to importing account', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csv = [CSV_HEADER, csvRow('DDD', 'DDD Corp', 100, 5000, '01/01/2026')].join('\n');

    await fixture.service.commitImport(importParams(csv, 'account-a'));
    await fixture.service.commitImport(importParams(csv, 'account-b'));

    // Re-import for account A -> should detect duplicate against A only
    const previewA = await fixture.service.previewImport(previewParams(csv, 'account-a'));
    expect(previewA.duplicateRows).toHaveLength(1);

    // Account B's record is not affected by A's dedup
    const recordsB = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-b');
    expect(recordsB).toHaveLength(1);
  });

  // IM5 (Critical): Re-import for account A -> account B records completely untouched
  it('IM5: re-import account A leaves account B records identical', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csvA = [
      CSV_HEADER,
      csvRow('EEE', 'EEE Corp', 100, 5000, '01/01/2026'),
      csvRow('FFF', 'FFF Corp', 50, 3000, '15/01/2026'),
    ].join('\n');
    const csvB = [CSV_HEADER, csvRow('GGG', 'GGG Corp', 200, 8000, '01/02/2026')].join('\n');

    await fixture.service.commitImport(importParams(csvA, 'account-a'));
    await fixture.service.commitImport(importParams(csvB, 'account-b'));

    const recordsBBefore = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-b');
    const snapshotB = JSON.stringify(recordsBBefore);

    // Re-import A with changed data (removed FFF, added HHH)
    const csvA2 = [
      CSV_HEADER,
      csvRow('EEE', 'EEE Corp', 100, 5000, '01/01/2026'),
      csvRow('HHH', 'HHH Corp', 75, 4000, '20/01/2026'),
    ].join('\n');
    await fixture.service.commitImport(importParams(csvA2, 'account-a'));

    const recordsBAfter = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-b');
    expect(recordsBAfter).toHaveLength(recordsBBefore.length);
    expect(JSON.stringify(recordsBAfter)).toBe(snapshotB);
  });

  // IM6: Undo import -> only soft-deletes records from the undone run's account
  it('IM6: undo only soft-deletes records from the undone run', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csvA = [CSV_HEADER, csvRow('III', 'III Corp', 100, 5000, '01/01/2026')].join('\n');
    const csvB = [CSV_HEADER, csvRow('JJJ', 'JJJ Corp', 200, 8000, '01/02/2026')].join('\n');

    await fixture.service.commitImport(importParams(csvA, 'account-a'));
    await fixture.service.commitImport(importParams(csvB, 'account-b'));

    // Undo the last import (account-b's)
    await fixture.service.undoLastImport('psagot-holdings-csv');

    // Account B's records should be soft-deleted
    const recordsB = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-b');
    expect(recordsB).toHaveLength(0);

    // Account A's records should be untouched
    const recordsA = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-a');
    expect(recordsA).toHaveLength(1);
  });

  // IM7: previewImport for account A shows duplicates only against account A's existing records
  it('IM7: preview shows duplicates scoped to importing account', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csv = [CSV_HEADER, csvRow('KKK', 'KKK Corp', 100, 5000, '01/01/2026')].join('\n');

    // Only import into account-a
    await fixture.service.commitImport(importParams(csv, 'account-a'));

    // Preview for account-a -> duplicate
    const previewA = await fixture.service.previewImport(previewParams(csv, 'account-a'));
    expect(previewA.duplicateRows).toHaveLength(1);
    expect(previewA.validRows).toHaveLength(0);

    // Preview for account-b -> valid (not duplicate)
    const previewB = await fixture.service.previewImport(previewParams(csv, 'account-b'));
    expect(previewB.duplicateRows).toHaveLength(0);
    expect(previewB.validRows).toHaveLength(1);
  });

  // IM8 (Critical): Sold-lot soft-delete scoped to selected account
  it('IM8: sold-lot soft-delete only affects the importing account', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csvBoth = [
      CSV_HEADER,
      csvRow('LLL', 'LLL Corp', 100, 5000, '01/01/2026'),
      csvRow('MMM', 'MMM Corp', 50, 3000, '15/01/2026'),
    ].join('\n');

    // Import both lots into account A and account B
    await fixture.service.commitImport(importParams(csvBoth, 'account-a'));
    await fixture.service.commitImport(importParams(csvBoth, 'account-b'));

    // Re-import account A with MMM removed (it was sold)
    const csvSold = [CSV_HEADER, csvRow('LLL', 'LLL Corp', 100, 5000, '01/01/2026')].join('\n');
    await fixture.service.commitImport(importParams(csvSold, 'account-a'));

    // Account A: MMM soft-deleted, LLL still active
    const recordsA = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-a');
    expect(recordsA).toHaveLength(1);
    expect(recordsA[0].securityId).toBe('LLL');

    // Account B: both lots still active (untouched by A's re-import)
    const recordsB = await fixture.repository.listHoldingRecordsByAccount('psagot', 'account-b');
    expect(recordsB).toHaveLength(2);
    expect(recordsB.map((r) => r.securityId).sort()).toEqual(['LLL', 'MMM']);
  });

  // Regression: existing import tests without accountId still work (defaults to "default")
  it('import without accountId defaults to "default" account', async () => {
    const fixture = makeFixture();
    await seedFixture(fixture);

    const csv = [CSV_HEADER, csvRow('NNN', 'NNN Corp', 100, 5000, '01/01/2026')].join('\n');

    const result = await fixture.service.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'test.csv',
      csvText: csv,
    });

    expect(result.importRun.accountId).toBe('default');

    const records = await fixture.repository.listHoldingRecordsByAccount('psagot', 'default');
    expect(records).toHaveLength(1);
    expect(records[0].accountId).toBe('default');
  });
});
