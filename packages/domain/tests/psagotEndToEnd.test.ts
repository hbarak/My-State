import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import { ImportRunQueryService } from '../src/services/ImportRunQueryService';
import { SecurityLotQueryService } from '../src/services/SecurityLotQueryService';
import { TotalHoldingsStateBuilder } from '../src/services/TotalHoldingsStateBuilder';
import type { ProviderIntegration, ProviderMappingProfile } from '../src/types';

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
const INTEGRATION_ID = 'integration-psagot-holdings';

function makePsagotFixture() {
  const repository = new LocalPortfolioRepository(new InMemoryStore());
  const importService = new PortfolioImportService(repository);
  const runQueryService = new ImportRunQueryService(repository);
  const lotQueryService = new SecurityLotQueryService(repository);
  const holdingsBuilder = new TotalHoldingsStateBuilder(repository);

  const now = new Date().toISOString();

  const integration: ProviderIntegration = {
    id: INTEGRATION_ID,
    providerId: PROVIDER_ID,
    kind: 'document',
    dataDomain: 'holdings',
    communicationMethod: 'document_csv',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'psagot.holdings.csv.v1',
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  };

  const profile: ProviderMappingProfile = {
    id: 'profile-psagot-v1',
    providerId: PROVIDER_ID,
    providerIntegrationId: INTEGRATION_ID,
    name: 'Psagot Holdings CSV v1 (Hebrew)',
    version: 1,
    isActive: true,
    inputFormat: 'csv',
    fieldMappings: {
      securityId: 'מספר ני"ע',
      securityName: 'שם נייר',
      actionType: 'סוג פעולה',
      quantity: 'כמות',
      costBasis: 'שער עלות למס',
      currency: 'מטבע',
      actionDate: 'תאריך ביצוע הפעולה',
      currentPrice: 'מחיר/שער',
    },
    requiredCanonicalFields: ['securityId', 'securityName', 'actionType', 'quantity', 'costBasis', 'currency', 'actionDate'],
    optionalCanonicalFields: ['currentPrice'],
    parsingRules: { monetaryUnit: 'agorot' },
    createdAt: now,
    updatedAt: now,
  };

  async function seed() {
    await repository.upsertProvider({
      id: PROVIDER_ID,
      name: 'Psagot',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);
  }

  return { repository, importService, runQueryService, lotQueryService, holdingsBuilder, seed };
}

// Mirrors the real Psagot CSV: Hebrew headers, comma-formatted numbers, quoted fields,
// multiple lots for the same security with different dates and cost bases.
const PSAGOT_CSV_JANUARY = [
  'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","69,058.60",ש"ח,31/07/2025,"97,410.00"',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","67,027.00",ש"ח,07/08/2025,"97,410.00"',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","79,867.80",ש"ח,17/10/2025,"97,410.00"',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"10.00","82,570.10",ש"ח,17/12/2025,"97,410.00"',
].join('\n');

// February CSV: same 4 lots but lot #1 now has 3 units (partial sell) and a different security added.
const PSAGOT_CSV_FEBRUARY = [
  'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"3.00","69,058.60",ש"ח,31/07/2025,"100,000.00"',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","67,027.00",ש"ח,07/08/2025,"100,000.00"',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","79,867.80",ש"ח,17/10/2025,"100,000.00"',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"10.00","82,570.10",ש"ח,17/12/2025,"100,000.00"',
  '1183441,S&amp;P500 אינ.חוץ,העברה חיצונית לח-ן,"39.00","4,308.66",ש"ח,02/09/2025,"4,500.00"',
].join('\n');

describe('Psagot end-to-end import', () => {
  it('imports multi-lot CSV with Hebrew headers and comma-formatted numbers', async () => {
    const { importService, seed } = makePsagotFixture();
    await seed();

    const preview = await importService.previewImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      csvText: PSAGOT_CSV_JANUARY,
    });

    expect(preview.validRows).toHaveLength(4);
    expect(preview.invalidRows).toHaveLength(0);
    expect(preview.duplicateRows).toHaveLength(0);

    // Verify normalization of first lot (agorot → ILS, ש"ח → ILS)
    const lot1 = preview.validRows[0]?.normalized as Record<string, unknown>;
    expect(lot1.securityId).toBe('1084128');
    expect(lot1.securityName).toBe('דלק קבוצה');
    expect(lot1.quantity).toBe(5);
    expect(lot1.costBasis).toBeCloseTo(690.586); // 69058.60 agorot / 100
    expect(lot1.actionDate).toBe('2025-07-31');
    expect(lot1.currentPrice).toBeCloseTo(974.10); // 97410.00 agorot / 100
    expect(lot1.currency).toBe('ILS');
  });

  it('commits and produces correct lot breakdown via SecurityLotQueryService', async () => {
    const { importService, lotQueryService, seed } = makePsagotFixture();
    await seed();

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot-jan-2026.csv',
      csvText: PSAGOT_CSV_JANUARY,
    });

    const position = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '1084128',
    });

    expect(position).not.toBeNull();
    expect(position!.lotCount).toBe(4);
    expect(position!.totalQuantity).toBe(25); // 5 + 5 + 5 + 10

    // FIFO order: oldest lot first
    expect(position!.lots[0].actionDate).toBe('2025-07-31');
    expect(position!.lots[0].quantity).toBe(5);
    expect(position!.lots[0].fifoOrder).toBe(1);

    expect(position!.lots[3].actionDate).toBe('2025-12-17');
    expect(position!.lots[3].quantity).toBe(10);
    expect(position!.lots[3].fifoOrder).toBe(4);

    // Totals — costBasis values are in ILS (agorot / 100), totalCost = costBasis * quantity
    // Lot costs: (5 * 690.586) + (5 * 670.27) + (5 * 798.678) + (10 * 825.701) = 19054.68
    const expectedTotalCost = (5 * 690.586) + (5 * 670.27) + (5 * 798.678) + (10 * 825.701);
    expect(position!.totalCost).toBeCloseTo(expectedTotalCost);
    expect(position!.currentPrice).toBeCloseTo(974.10); // 97410 agorot / 100
    expect(position!.unrealizedGain).toBeCloseTo(974.10 * 25 - expectedTotalCost);
  });

  it('produces correct aggregated TotalHoldingsState from multi-lot import', async () => {
    const { importService, holdingsBuilder, seed } = makePsagotFixture();
    await seed();

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot-jan-2026.csv',
      csvText: PSAGOT_CSV_JANUARY,
    });

    const state = await holdingsBuilder.build({ providerId: PROVIDER_ID });

    expect(state.positionCount).toBe(1); // one security: 1084128
    const delek = state.positions[0];
    expect(delek.securityId).toBe('1084128');
    expect(delek.quantity).toBe(25);
    expect(delek.lotCount).toBe(4);
    expect(delek.currentPrice).toBeCloseTo(974.10); // 97410 agorot / 100

    // Valuation: 25 * 974.10 = 24,352.50
    expect(state.valuationTotalsByCurrency['ILS']).toBeCloseTo(24352.50);
  });

  it('run summary reflects all imported lots', async () => {
    const { importService, runQueryService, seed } = makePsagotFixture();
    await seed();

    const commit = await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot-jan-2026.csv',
      csvText: PSAGOT_CSV_JANUARY,
    });

    const summary = await runQueryService.getRunSummary(commit.importRun.id);

    expect(summary!.rawRowCounts.total).toBe(4);
    expect(summary!.rawRowCounts.valid).toBe(4);
    expect(summary!.lotCount).toBe(4);
  });

  it('deduplicates unchanged lots on re-import', async () => {
    const { importService, seed } = makePsagotFixture();
    await seed();

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot-jan-2026.csv',
      csvText: PSAGOT_CSV_JANUARY,
    });

    // Re-import same CSV
    const preview = await importService.previewImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      csvText: PSAGOT_CSV_JANUARY,
    });

    expect(preview.validRows).toHaveLength(0);
    expect(preview.duplicateRows).toHaveLength(4);
  });

  it('re-import updates lot with changed quantity and adds new securities', async () => {
    const { importService, lotQueryService, seed } = makePsagotFixture();
    await seed();

    // Import January: 4 Delek lots, total 25 units
    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot-jan-2026.csv',
      csvText: PSAGOT_CSV_JANUARY,
    });

    // Import February: lot #1 now has quantity 3 (partial sell), plus a new security (S&P500)
    const preview = await importService.previewImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      csvText: PSAGOT_CSV_FEBRUARY,
    });

    // 3 unchanged Delek lots are duplicates
    // 1 changed Delek lot (qty 5→3) is valid with LOT_QUANTITY_CHANGED code
    // 1 S&P500 lot is new (valid)
    expect(preview.duplicateRows).toHaveLength(3);
    expect(preview.validRows).toHaveLength(2);

    const changedLot = preview.validRows.find((r) => r.errorCode === 'LOT_QUANTITY_CHANGED');
    expect(changedLot).toBeDefined();
    expect(changedLot!.errorMessage).toContain('5');
    expect(changedLot!.errorMessage).toContain('3');

    // Commit February
    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot-feb-2026.csv',
      csvText: PSAGOT_CSV_FEBRUARY,
    });

    // Lot #1 was UPDATED (5→3), not duplicated. Still 4 Delek lots.
    const delek = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '1084128',
    });

    expect(delek!.lotCount).toBe(4);
    expect(delek!.totalQuantity).toBe(23); // 3 + 5 + 5 + 10 (was 5 + 5 + 5 + 10 = 25)

    // S&P500 lot was added
    const sp500 = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '1183441',
    });
    expect(sp500).not.toBeNull();
    expect(sp500!.securityName).toBe('S&P500 אינ.חוץ'); // HTML entity decoded
    expect(sp500!.totalQuantity).toBe(39);
  });

  it('re-import soft-deletes lots that disappeared (fully sold)', async () => {
    const { importService, lotQueryService, seed } = makePsagotFixture();
    await seed();

    // Import: 4 Delek lots
    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot-jan-2026.csv',
      csvText: PSAGOT_CSV_JANUARY,
    });

    // New CSV: only 2 of the 4 Delek lots remain (2 were sold)
    const csvSold = [
      'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
      '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","79,867.80",ש"ח,17/10/2025,"100,000.00"',
      '1084128,דלק קבוצה,העברה חיצונית לח-ן,"10.00","82,570.10",ש"ח,17/12/2025,"100,000.00"',
    ].join('\n');

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot-feb-2026.csv',
      csvText: csvSold,
    });

    const delek = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '1084128',
    });

    // Only 2 lots remain (the Jul and Aug lots were soft-deleted)
    expect(delek!.lotCount).toBe(2);
    expect(delek!.totalQuantity).toBe(15); // 5 + 10
  });
});
