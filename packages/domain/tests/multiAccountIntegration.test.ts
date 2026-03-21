import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import { AccountService } from '../src/services/AccountService';
import { TotalHoldingsStateBuilder } from '../src/services/TotalHoldingsStateBuilder';
import { SecurityLotQueryService } from '../src/services/SecurityLotQueryService';
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

function csvRow(securityId: string, name: string, qty: number, costBasis: number, date: string, price: number = 10000): string {
  return `${securityId},${name},קניה,${qty},${costBasis},ש"ח,${date},${price}`;
}

function makeFixture() {
  const store = new InMemoryStore();
  const repository = new LocalPortfolioRepository(store);
  const importService = new PortfolioImportService(repository);
  const accountService = new AccountService(repository);
  const holdingsBuilder = new TotalHoldingsStateBuilder(repository);
  const lotQuery = new SecurityLotQueryService(repository);

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
    parsingRules: { monetaryUnit: 'agorot' },
  };

  return { store, repository, importService, accountService, holdingsBuilder, lotQuery, provider, integration, profile };
}

async function seedFixture(f: ReturnType<typeof makeFixture>) {
  await f.repository.upsertProvider(f.provider);
  await f.repository.upsertIntegration(f.integration);
  await f.repository.upsertMappingProfile(f.profile);
}

describe('Multi-Account Integration Tests (S3-DEV-06)', () => {
  // INT1: Full flow — create 2 accounts, import CSV into each, aggregate, verify unified positions
  it('INT1: full multi-account flow — import, aggregate, account breakdown', async () => {
    const f = makeFixture();
    await seedFixture(f);

    await f.accountService.createAccount({ id: 'joint', providerId: 'psagot', name: 'Joint Account' });
    await f.accountService.createAccount({ id: 'ira', providerId: 'psagot', name: 'IRA Account' });

    // Joint: 2 lots of Leumi, 1 lot of Teva
    const csvJoint = [
      CSV_HEADER,
      csvRow('1084128', 'Leumi', 100, 5000, '01/01/2026'),
      csvRow('1084128', 'Leumi', 50, 5500, '15/02/2026'),
      csvRow('5554321', 'Teva', 200, 3000, '01/03/2026'),
    ].join('\n');

    // IRA: 1 lot of Leumi (different quantity/cost)
    const csvIra = [
      CSV_HEADER,
      csvRow('1084128', 'Leumi', 75, 4800, '10/01/2026'),
    ].join('\n');

    await f.importService.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'joint.csv',
      csvText: csvJoint,
      accountId: 'joint',
    });

    await f.importService.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'ira.csv',
      csvText: csvIra,
      accountId: 'ira',
    });

    // --- Verify aggregation ---
    const state = await f.holdingsBuilder.build({ providerId: 'psagot' });

    // 2 unified positions: Leumi (cross-account) and Teva (joint only)
    expect(state.positions).toHaveLength(2);

    const leumi = state.positions.find((p) => p.securityId === '1084128')!;
    expect(leumi.quantity).toBe(225); // 100 + 50 + 75
    expect(leumi.accountIds).toEqual(['ira', 'joint']);
    expect(leumi.lotCount).toBe(3);

    const teva = state.positions.find((p) => p.securityId === '5554321')!;
    expect(teva.quantity).toBe(200);
    expect(teva.accountIds).toEqual(['joint']);

    // --- Verify drill-down with account breakdown ---
    const leumiDrill = await f.lotQuery.getSecurityLots({ providerId: 'psagot', securityId: '1084128' });
    expect(leumiDrill).not.toBeNull();
    expect(leumiDrill!.totalQuantity).toBe(225);
    expect(leumiDrill!.accountBreakdown).toHaveLength(2);

    const jointBreakdown = leumiDrill!.accountBreakdown.find((b) => b.accountId === 'joint')!;
    expect(jointBreakdown.accountName).toBe('Joint Account');
    expect(jointBreakdown.quantity).toBe(150); // 100 + 50
    expect(jointBreakdown.lotCount).toBe(2);

    const iraBreakdown = leumiDrill!.accountBreakdown.find((b) => b.accountId === 'ira')!;
    expect(iraBreakdown.accountName).toBe('IRA Account');
    expect(iraBreakdown.quantity).toBe(75);
    expect(iraBreakdown.lotCount).toBe(1);

    // FIFO global: ira lot (Jan 10) < joint lot 1 (Jan 1... wait, Jan 1 < Jan 10)
    // joint lot 1: 2026-01-01, ira lot: 2026-01-10, joint lot 2: 2026-02-15
    expect(leumiDrill!.lots[0].actionDate).toBe('2026-01-01');
    expect(leumiDrill!.lots[1].actionDate).toBe('2026-01-10');
    expect(leumiDrill!.lots[2].actionDate).toBe('2026-02-15');
  });

  // INT2: Re-import account A with changed data, account B unchanged, aggregated totals updated
  it('INT2: re-import one account leaves other untouched, totals updated', async () => {
    const f = makeFixture();
    await seedFixture(f);

    await f.accountService.createAccount({ id: 'a', providerId: 'psagot', name: 'A' });
    await f.accountService.createAccount({ id: 'b', providerId: 'psagot', name: 'B' });

    const csvA = [CSV_HEADER, csvRow('SEC1', 'Sec One', 100, 5000, '01/01/2026')].join('\n');
    const csvB = [CSV_HEADER, csvRow('SEC1', 'Sec One', 50, 6000, '15/01/2026')].join('\n');

    await f.importService.commitImport({
      providerId: 'psagot', providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'a.csv', csvText: csvA, accountId: 'a',
    });
    await f.importService.commitImport({
      providerId: 'psagot', providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'b.csv', csvText: csvB, accountId: 'b',
    });

    const stateBefore = await f.holdingsBuilder.build({ providerId: 'psagot' });
    expect(stateBefore.positions[0].quantity).toBe(150); // 100 + 50

    // Snapshot B's records
    const recordsBBefore = await f.repository.listHoldingRecordsByAccount('psagot', 'b');
    const snapshotB = JSON.stringify(recordsBBefore);

    // Re-import A with reduced quantity
    const csvA2 = [CSV_HEADER, csvRow('SEC1', 'Sec One', 80, 5000, '01/01/2026')].join('\n');
    await f.importService.commitImport({
      providerId: 'psagot', providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'a2.csv', csvText: csvA2, accountId: 'a',
    });

    // B untouched
    const recordsBAfter = await f.repository.listHoldingRecordsByAccount('psagot', 'b');
    expect(JSON.stringify(recordsBAfter)).toBe(snapshotB);

    // Aggregated totals updated
    const stateAfter = await f.holdingsBuilder.build({ providerId: 'psagot' });
    expect(stateAfter.positions[0].quantity).toBe(130); // 80 + 50
  });

  // INT3: Import -> undo -> re-import cycle for one account while other is stable
  it('INT3: undo and re-import one account, other stable', async () => {
    const f = makeFixture();
    await seedFixture(f);

    await f.accountService.createAccount({ id: 'volatile', providerId: 'psagot', name: 'Volatile' });
    await f.accountService.createAccount({ id: 'stable', providerId: 'psagot', name: 'Stable' });

    const csvStable = [CSV_HEADER, csvRow('AAA', 'AAA Corp', 100, 5000, '01/01/2026')].join('\n');
    const csvVolatile = [CSV_HEADER, csvRow('AAA', 'AAA Corp', 50, 6000, '15/01/2026')].join('\n');

    await f.importService.commitImport({
      providerId: 'psagot', providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'stable.csv', csvText: csvStable, accountId: 'stable',
    });
    await f.importService.commitImport({
      providerId: 'psagot', providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'volatile.csv', csvText: csvVolatile, accountId: 'volatile',
    });

    // State before undo: 150 total
    const state1 = await f.holdingsBuilder.build({ providerId: 'psagot' });
    expect(state1.positions[0].quantity).toBe(150);

    // Undo volatile's import (last successful run)
    await f.importService.undoLastImport('psagot-holdings-csv');

    // State after undo: only stable's 100
    const state2 = await f.holdingsBuilder.build({ providerId: 'psagot' });
    expect(state2.positions[0].quantity).toBe(100);
    expect(state2.positions[0].accountIds).toEqual(['stable']);

    // Re-import volatile with new data
    const csvVolatile2 = [CSV_HEADER, csvRow('AAA', 'AAA Corp', 75, 5500, '20/01/2026')].join('\n');
    await f.importService.commitImport({
      providerId: 'psagot', providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'volatile2.csv', csvText: csvVolatile2, accountId: 'volatile',
    });

    // State after re-import: 100 + 75 = 175
    const state3 = await f.holdingsBuilder.build({ providerId: 'psagot' });
    expect(state3.positions[0].quantity).toBe(175);
    expect(state3.positions[0].accountIds).toEqual(['stable', 'volatile']);
  });

  // INT4: Single-account flow (default) behaves identically to R2
  it('INT4: single-account default flow matches R2 behavior', async () => {
    const f = makeFixture();
    await seedFixture(f);

    const csv = [
      CSV_HEADER,
      csvRow('1084128', 'Leumi', 100, 5000, '01/01/2026'),
      csvRow('1084128', 'Leumi', 50, 5500, '15/02/2026'),
      csvRow('5554321', 'Teva', 200, 3000, '01/03/2026'),
    ].join('\n');

    // No explicit accountId — defaults to "default"
    await f.importService.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'test.csv',
      csvText: csv,
    });

    const state = await f.holdingsBuilder.build({ providerId: 'psagot' });
    expect(state.positions).toHaveLength(2);

    const leumi = state.positions.find((p) => p.securityId === '1084128')!;
    expect(leumi.quantity).toBe(150);
    expect(leumi.accountIds).toEqual(['default']);

    const teva = state.positions.find((p) => p.securityId === '5554321')!;
    expect(teva.quantity).toBe(200);
    expect(teva.accountIds).toEqual(['default']);

    // Drill-down: single account, no grouping needed
    const leumiDrill = await f.lotQuery.getSecurityLots({ providerId: 'psagot', securityId: '1084128' });
    expect(leumiDrill!.accountBreakdown).toHaveLength(1);
    expect(leumiDrill!.accountBreakdown[0].accountId).toBe('default');
    expect(leumiDrill!.accountBreakdown[0].quantity).toBe(150);

    // Re-import (duplicate detection still works)
    const preview = await f.importService.previewImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      csvText: csv,
    });
    expect(preview.duplicateRows).toHaveLength(3);
    expect(preview.validRows).toHaveLength(0);
  });
});
