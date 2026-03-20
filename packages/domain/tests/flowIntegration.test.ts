import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import { TotalHoldingsStateBuilder } from '../src/services/TotalHoldingsStateBuilder';
import { SecurityLotQueryService } from '../src/services/SecurityLotQueryService';
import { ImportRunQueryService } from '../src/services/ImportRunQueryService';
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

function makeFlowFixture() {
  const store = new InMemoryStore();
  const repository = new LocalPortfolioRepository(store);
  const importService = new PortfolioImportService(repository);
  const holdingsBuilder = new TotalHoldingsStateBuilder(repository);
  const lotQueryService = new SecurityLotQueryService(repository);
  const runQueryService = new ImportRunQueryService(repository);

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

  return { repository, importService, holdingsBuilder, lotQueryService, runQueryService, seed, integration, profile };
}

const VALID_CSV = [
  'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","69,058.60",ש"ח,31/07/2025,"97,410.00"',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","67,027.00",ש"ח,07/08/2025,"97,410.00"',
].join('\n');

// CSV with one valid row and one row missing a required field (securityName empty)
const MIXED_VALID_INVALID_CSV = [
  'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","69,058.60",ש"ח,31/07/2025,"97,410.00"',
  '1084128,,העברה חיצונית לח-ן,"5.00","67,027.00",ש"ח,07/08/2025,"97,410.00"',
].join('\n');

describe('Flow integration tests (S1-10)', () => {
  it('full guided loop: preview → commit → query holdings → undo → holdings empty', async () => {
    const { importService, holdingsBuilder, lotQueryService, seed } = makeFlowFixture();
    await seed();

    // Step 1: Preview
    const preview = await importService.previewImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      csvText: VALID_CSV,
    });
    expect(preview.validRows).toHaveLength(2);
    expect(preview.invalidRows).toHaveLength(0);
    expect(preview.duplicateRows).toHaveLength(0);

    // Step 2: Commit
    const commit = await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'jan-2026.csv',
      csvText: VALID_CSV,
    });
    expect(commit.importedTrades).toBe(2);
    expect(commit.importRun.status).toBe('success');
    expect(commit.importRun.isUndoable).toBe(true);

    // Step 3: Query holdings — should show 1 position with 2 lots
    const holdings = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    expect(holdings.positionCount).toBe(1);
    expect(holdings.positions[0].quantity).toBe(10); // 5 + 5
    expect(holdings.positions[0].lotCount).toBe(2);

    const lots = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '1084128',
    });
    expect(lots).not.toBeNull();
    expect(lots!.lotCount).toBe(2);
    expect(lots!.lots[0].fifoOrder).toBe(1);

    // Step 4: Undo
    const undone = await importService.undoLastImport(INTEGRATION_ID);
    expect(undone).not.toBeNull();
    expect(undone!.isUndoable).toBe(false);
    expect(undone!.undoneAt).toBeDefined();

    // Step 5: Holdings should now be empty
    const holdingsAfter = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    expect(holdingsAfter.positionCount).toBe(0);

    const lotsAfter = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '1084128',
    });
    expect(lotsAfter).toBeNull();
  });

  it('blocker resolution: invalid rows skipped, only valid rows committed', async () => {
    const { importService, holdingsBuilder, runQueryService, seed } = makeFlowFixture();
    await seed();

    // Preview shows 1 valid + 1 invalid
    const preview = await importService.previewImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      csvText: MIXED_VALID_INVALID_CSV,
    });
    expect(preview.validRows).toHaveLength(1);
    expect(preview.invalidRows).toHaveLength(1);
    expect(preview.invalidRows[0].errorCode).toBe('MISSING_REQUIRED_FIELDS');

    // Commit — imports only valid rows, stores all raw rows
    const commit = await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'mixed.csv',
      csvText: MIXED_VALID_INVALID_CSV,
    });
    expect(commit.importedTrades).toBe(1);
    expect(commit.errorRows).toBe(1);

    // Holdings show only the valid lot
    const holdings = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    expect(holdings.positionCount).toBe(1);
    expect(holdings.positions[0].lotCount).toBe(1);
    expect(holdings.positions[0].quantity).toBe(5);

    // Run summary reflects both valid and invalid raw rows
    const summary = await runQueryService.getRunSummary(commit.importRun.id);
    expect(summary!.rawRowCounts.valid).toBe(1);
    expect(summary!.rawRowCounts.invalid).toBe(1);
    expect(summary!.rawRowCounts.total).toBe(2);
  });

  it('undo durability: second undo returns null', async () => {
    const { importService, seed } = makeFlowFixture();
    await seed();

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'jan-2026.csv',
      csvText: VALID_CSV,
    });

    // First undo succeeds
    const firstUndo = await importService.undoLastImport(INTEGRATION_ID);
    expect(firstUndo).not.toBeNull();
    expect(firstUndo!.isUndoable).toBe(false);

    // Second undo returns null (no undoable run)
    const secondUndo = await importService.undoLastImport(INTEGRATION_ID);
    expect(secondUndo).toBeNull();
  });

  it('re-import after undo: same CSV re-imports fresh', async () => {
    const { importService, holdingsBuilder, seed } = makeFlowFixture();
    await seed();

    // Import
    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'jan-2026.csv',
      csvText: VALID_CSV,
    });

    // Undo (soft-deletes records)
    await importService.undoLastImport(INTEGRATION_ID);

    // Holdings should be empty after undo
    const holdingsAfterUndo = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    expect(holdingsAfterUndo.positionCount).toBe(0);

    // Re-import same CSV — should not be treated as duplicate
    const preview = await importService.previewImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      csvText: VALID_CSV,
    });
    expect(preview.validRows).toHaveLength(2);
    expect(preview.duplicateRows).toHaveLength(0);

    // Commit re-import
    const commit = await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'jan-2026-reimport.csv',
      csvText: VALID_CSV,
    });
    expect(commit.importedTrades).toBe(2);

    // Holdings should be back
    const holdingsAfterReimport = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    expect(holdingsAfterReimport.positionCount).toBe(1);
    expect(holdingsAfterReimport.positions[0].quantity).toBe(10);
    expect(holdingsAfterReimport.positions[0].lotCount).toBe(2);
  });

  it('holdings trust with mixed data: only valid lots appear in queries', async () => {
    const { importService, lotQueryService, seed } = makeFlowFixture();
    await seed();

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'mixed.csv',
      csvText: MIXED_VALID_INVALID_CSV,
    });

    // SecurityLotQueryService should only show the valid lot
    const position = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '1084128',
    });
    expect(position).not.toBeNull();
    expect(position!.lotCount).toBe(1);
    expect(position!.totalQuantity).toBe(5);

    // Portfolio view should show exactly 1 position
    const portfolio = await lotQueryService.getPortfolioLots({ providerId: PROVIDER_ID });
    expect(portfolio.positionCount).toBe(1);
  });

  it('multi-provider isolation: each provider sees only its own data', async () => {
    const { repository, importService, holdingsBuilder, lotQueryService, seed, profile } = makeFlowFixture();
    await seed();

    // Set up a second provider
    const now = new Date().toISOString();
    const provider2Id = 'provider-meitav';
    const integration2Id = 'integration-meitav-holdings';

    await repository.upsertProvider({
      id: provider2Id,
      name: 'Meitav',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await repository.upsertIntegration({
      id: integration2Id,
      providerId: provider2Id,
      kind: 'document',
      dataDomain: 'holdings',
      communicationMethod: 'document_csv',
      syncMode: 'manual',
      direction: 'ingest',
      adapterKey: 'psagot.holdings.csv.v1',
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await repository.upsertMappingProfile({
      ...profile,
      id: 'profile-meitav-v1',
      providerId: provider2Id,
      providerIntegrationId: integration2Id,
    });

    const meitavCsv = [
      'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
      '9999999,בנק הפועלים,העברה חיצונית לח-ן,"100.00","50.00",ש"ח,01/01/2025,"60.00"',
    ].join('\n');

    // Import to provider 1
    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'psagot.csv',
      csvText: VALID_CSV,
    });

    // Import to provider 2
    await importService.commitImport({
      providerId: provider2Id,
      providerIntegrationId: integration2Id,
      sourceName: 'meitav.csv',
      csvText: meitavCsv,
    });

    // Each provider's holdings are isolated
    const psagotHoldings = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    expect(psagotHoldings.positionCount).toBe(1);
    expect(psagotHoldings.positions[0].securityId).toBe('1084128');
    expect(psagotHoldings.positions[0].quantity).toBe(10);

    const meitavHoldings = await holdingsBuilder.build({ providerId: provider2Id });
    expect(meitavHoldings.positionCount).toBe(1);
    expect(meitavHoldings.positions[0].securityId).toBe('9999999');
    expect(meitavHoldings.positions[0].quantity).toBe(100);

    // Lot queries are also isolated
    const psagotLots = await lotQueryService.getPortfolioLots({ providerId: PROVIDER_ID });
    expect(psagotLots.positionCount).toBe(1);

    const meitavLots = await lotQueryService.getPortfolioLots({ providerId: provider2Id });
    expect(meitavLots.positionCount).toBe(1);

    // Provider 1 doesn't see provider 2's security
    const crossCheck = await lotQueryService.getSecurityLots({
      providerId: PROVIDER_ID,
      securityId: '9999999',
    });
    expect(crossCheck).toBeNull();
  });
});
