/**
 * S6-DEV-01: Re-import idempotency tests (AC 1 + AC 2)
 *
 * AC 1: Re-uploading the same CSV produces identical portfolio state.
 * AC 2: Cross-account isolation — importing one account never touches another.
 *
 * TDD order per QA spec: write AC 2 first, then AC 1.
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

const CSV_HEADER = 'SecurityId,Name,ActionType,Qty,CostBasis,Currency,ActionDate,CurrentPrice';

function csvRow(
  securityId: string,
  name: string,
  qty: number,
  costBasis: number,
  date: string,
  price: number = 100,
): string {
  return `${securityId},${name},Buy,${qty},${costBasis},ILS,${date},${price}`;
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
      currentPrice: 'CurrentPrice',
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
    optionalCanonicalFields: ['currentPrice'],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  async function seed() {
    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);
  }

  const importParams = (csvText: string, accountId: string) => ({
    providerId: 'psagot',
    providerIntegrationId: 'psagot-holdings-csv',
    sourceName: 'test.csv',
    csvText,
    accountId,
  });

  return { repository, service, seed, importParams };
}

// ─────────────────────────────────────────────────────────────────────────────
// AC 2 — Cross-account isolation (critical invariant)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC 2 — Cross-account isolation', () => {
  it('AC2-1: import account A CSV then re-import — account B lots are untouched', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csvA = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026'),
      csvRow('BBB', 'Stock B', 50, 3000, '15/01/2026'),
    ].join('\n');
    const csvB = [CSV_HEADER, csvRow('CCC', 'Stock C', 200, 8000, '01/02/2026')].join('\n');

    await service.commitImport(importParams(csvA, 'account-a'));
    await service.commitImport(importParams(csvB, 'account-b'));

    const lotsBefore = await repository.listHoldingRecordsByAccount('psagot', 'account-b');
    const snapshot = JSON.stringify(lotsBefore);

    // Re-import account A
    await service.commitImport(importParams(csvA, 'account-a'));

    const lotsAfter = await repository.listHoldingRecordsByAccount('psagot', 'account-b');
    expect(lotsAfter).toHaveLength(lotsBefore.length);
    expect(JSON.stringify(lotsAfter)).toBe(snapshot);
  });

  it('AC2-2: same securityId in two accounts are separate lots — dedup does not merge them', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('SAME', 'Same Corp', 100, 5000, '01/01/2026')].join('\n');

    await service.commitImport(importParams(csv, 'account-a'));
    await service.commitImport(importParams(csv, 'account-b'));

    const lotsA = await repository.listHoldingRecordsByAccount('psagot', 'account-a');
    const lotsB = await repository.listHoldingRecordsByAccount('psagot', 'account-b');

    expect(lotsA).toHaveLength(1);
    expect(lotsB).toHaveLength(1);
    expect(lotsA[0]!.id).not.toBe(lotsB[0]!.id);
    expect(lotsA[0]!.accountId).toBe('account-a');
    expect(lotsB[0]!.accountId).toBe('account-b');
  });

  it('AC2-3: delete account A run contribution leaves account B lots untouched', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csvA = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    const csvB = [CSV_HEADER, csvRow('BBB', 'Stock B', 200, 8000, '01/02/2026')].join('\n');

    const runA = await service.commitImport(importParams(csvA, 'account-a'));
    await service.commitImport(importParams(csvB, 'account-b'));

    const lotsBefore = await repository.listHoldingRecordsByAccount('psagot', 'account-b');

    await repository.deleteImportRunContribution(runA.importRun.id);

    const lotsAfter = await repository.listHoldingRecordsByAccount('psagot', 'account-b');
    expect(JSON.stringify(lotsAfter)).toBe(JSON.stringify(lotsBefore));
    // Account A lots should be gone
    const lotsA = await repository.listHoldingRecordsByAccount('psagot', 'account-a');
    expect(lotsA).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC 1 — Re-import idempotency (Option A: currentPrice never stored)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC 1 — Re-import idempotency', () => {
  it('AC1-1: re-uploading identical CSV produces identical portfolio state', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026', 120),
      csvRow('BBB', 'Stock B', 50, 3000, '15/01/2026', 90),
    ].join('\n');

    await service.commitImport(importParams(csv, 'default'));
    const lotsAfterFirst = await repository.listHoldingRecordsByAccount('psagot', 'default');

    // Re-import same CSV (second call, potentially different currentPrice in future)
    await service.commitImport(importParams(csv, 'default'));
    const lotsAfterSecond = await repository.listHoldingRecordsByAccount('psagot', 'default');

    // Same lot count
    expect(lotsAfterSecond).toHaveLength(lotsAfterFirst.length);

    // Key fields identical
    const normalize = (lots: typeof lotsAfterFirst) =>
      lots.map((l) => ({
        securityId: l.securityId,
        quantity: l.quantity,
        costBasis: l.costBasis,
        actionDate: l.actionDate,
      })).sort((a, b) => a.securityId.localeCompare(b.securityId));

    expect(normalize(lotsAfterSecond)).toEqual(normalize(lotsAfterFirst));
  });

  it('AC1-2: currentPrice is not stored on ProviderHoldingRecord after commit (Option A)', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026', 150)].join('\n');

    await service.commitImport(importParams(csv, 'default'));

    const lots = await repository.listHoldingRecordsByAccount('psagot', 'default');
    expect(lots).toHaveLength(1);
    // currentPrice must NOT be persisted (Option A)
    expect(lots[0]!.currentPrice).toBeUndefined();
  });

  it('AC1-3: re-upload with one row quantity changed — only that lot updated, others unchanged', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csvV1 = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026'),
      csvRow('BBB', 'Stock B', 50, 3000, '15/01/2026'),
    ].join('\n');

    await service.commitImport(importParams(csvV1, 'default'));

    // Re-upload with BBB quantity changed from 50 to 40 (partial sell)
    const csvV2 = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026'),
      csvRow('BBB', 'Stock B', 40, 3000, '15/01/2026'),
    ].join('\n');

    await service.commitImport(importParams(csvV2, 'default'));

    const lots = await repository.listHoldingRecordsByAccount('psagot', 'default');
    expect(lots).toHaveLength(2);

    const aaa = lots.find((l) => l.securityId === 'AAA');
    const bbb = lots.find((l) => l.securityId === 'BBB');

    expect(aaa!.quantity).toBe(100); // unchanged
    expect(bbb!.quantity).toBe(40);  // updated
  });

  it('AC1-4: re-upload with one row removed — that lot soft-deleted, others unchanged', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csvV1 = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026'),
      csvRow('BBB', 'Stock B', 50, 3000, '15/01/2026'),
    ].join('\n');

    await service.commitImport(importParams(csvV1, 'default'));

    // Re-upload without BBB (it was sold)
    const csvV2 = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026')].join('\n');
    await service.commitImport(importParams(csvV2, 'default'));

    const lots = await repository.listHoldingRecordsByAccount('psagot', 'default');
    expect(lots).toHaveLength(1);
    expect(lots[0]!.securityId).toBe('AAA');
  });

  it('AC1-5: triple re-upload of same CSV remains idempotent', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv = [
      CSV_HEADER,
      csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026'),
    ].join('\n');

    await service.commitImport(importParams(csv, 'default'));
    await service.commitImport(importParams(csv, 'default'));
    await service.commitImport(importParams(csv, 'default'));

    const lots = await repository.listHoldingRecordsByAccount('psagot', 'default');
    expect(lots).toHaveLength(1);
    expect(lots[0]!.quantity).toBe(100);
    expect(lots[0]!.currentPrice).toBeUndefined();
  });

  it('AC1-6: currentPrice in CSV with different value on re-upload does not change stored lots', async () => {
    const { repository, service, seed, importParams } = makeFixture();
    await seed();

    const csv1 = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026', 120)].join('\n');
    const csv2 = [CSV_HEADER, csvRow('AAA', 'Stock A', 100, 5000, '01/01/2026', 999)].join('\n');

    await service.commitImport(importParams(csv1, 'default'));
    const lotsAfterFirst = await repository.listHoldingRecordsByAccount('psagot', 'default');

    await service.commitImport(importParams(csv2, 'default'));
    const lotsAfterSecond = await repository.listHoldingRecordsByAccount('psagot', 'default');

    expect(lotsAfterSecond).toHaveLength(1);
    // currentPrice must not be stored — so different CSV price cannot change stored state
    expect(lotsAfterSecond[0]!.currentPrice).toBeUndefined();
    expect(lotsAfterSecond[0]!.quantity).toBe(lotsAfterFirst[0]!.quantity);
    expect(lotsAfterSecond[0]!.costBasis).toBe(lotsAfterFirst[0]!.costBasis);
  });
});
