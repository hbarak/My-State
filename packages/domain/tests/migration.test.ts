import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import { AccountService } from '../src/services/AccountService';
import { TotalHoldingsStateBuilder } from '../src/services/TotalHoldingsStateBuilder';
import { ensureDefaultAccounts } from '../src/services/AccountService';
import type { Provider, ProviderIntegration, ProviderMappingProfile } from '../src/types';

class InMemoryStore implements JsonStore {
  private readonly mem = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.mem.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
  }

  /** Direct write to simulate R2 data without accountId */
  async writeRawRecords(key: string, records: Record<string, unknown>[]): Promise<void> {
    this.mem.set(key, JSON.stringify(records));
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

const CSV_HEADER = 'מספר ני"ע,שם ני"ע,סוג פעולה,כמות,שער עלות,מטבע,תאריך פעולה,שער נוכחי';

function csvRow(securityId: string, name: string, qty: number, costBasis: number, date: string): string {
  return `${securityId},${name},קניה,${qty},${costBasis},ש"ח,${date},10000`;
}

function makeFixture() {
  const store = new InMemoryStore();
  const repository = new LocalPortfolioRepository(store);
  const importService = new PortfolioImportService(repository);
  const accountService = new AccountService(repository);
  const holdingsBuilder = new TotalHoldingsStateBuilder(repository);

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

  return { store, repository, importService, accountService, holdingsBuilder, provider, integration, profile };
}

async function seedFixture(f: ReturnType<typeof makeFixture>) {
  await f.repository.upsertProvider(f.provider);
  await f.repository.upsertIntegration(f.integration);
  await f.repository.upsertMappingProfile(f.profile);
}

/** Simulate R2 records — no accountId field at all */
function r2HoldingRecord(id: string, securityId: string, quantity: number, costBasis: number) {
  return {
    id,
    providerId: 'psagot',
    providerIntegrationId: 'psagot-holdings-csv',
    importRunId: 'run-legacy',
    // NO accountId field — this is what R2 data looks like
    securityId,
    securityName: `${securityId} Corp`,
    actionType: 'קניה',
    quantity,
    costBasis,
    currency: 'ILS',
    actionDate: '2026-01-15',
    currentPrice: 120,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function r2ImportRun(id: string) {
  return {
    id,
    providerId: 'psagot',
    providerIntegrationId: 'psagot-holdings-csv',
    sourceName: 'legacy.csv',
    status: 'success',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    importedCount: 1,
    skippedCount: 0,
    errorCount: 0,
    isUndoable: true,
  };
}

describe('Data Migration (S3-DEV-07)', () => {
  // MG1: Records without accountId -> on-read returns them with accountId: "default"
  it('MG1: on-read migration assigns "default" to records without accountId', async () => {
    const f = makeFixture();

    // Write R2-era records directly (no accountId field)
    await f.store.writeRawRecords('portfolio-holding-records.v1', [
      r2HoldingRecord('lot-1', 'AAA', 100, 50),
      r2HoldingRecord('lot-2', 'BBB', 200, 30),
    ]);

    const records = await f.repository.listHoldingRecordsByProvider('psagot');
    expect(records).toHaveLength(2);
    expect(records[0].accountId).toBe('default');
    expect(records[1].accountId).toBe('default');
  });

  // MG2: Default account auto-created on bootstrap per provider
  it('MG2: ensureDefaultAccounts creates default account per provider', async () => {
    const f = makeFixture();
    await f.repository.upsertProvider(f.provider);

    // Another provider
    await f.repository.upsertProvider({
      id: 'ib',
      name: 'Interactive Brokers',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    await ensureDefaultAccounts(f.repository);

    const psagotAccounts = await f.accountService.listByProvider('psagot');
    expect(psagotAccounts).toHaveLength(1);
    expect(psagotAccounts[0].id).toBe('default');
    expect(psagotAccounts[0].name).toBe('Default Account');

    const ibAccounts = await f.accountService.listByProvider('ib');
    expect(ibAccounts).toHaveLength(1);
    expect(ibAccounts[0].id).toBe('default');
  });

  // MG2b: ensureDefaultAccounts is idempotent — doesn't duplicate if already exists
  it('MG2b: ensureDefaultAccounts is idempotent', async () => {
    const f = makeFixture();
    await f.repository.upsertProvider(f.provider);

    await ensureDefaultAccounts(f.repository);
    await ensureDefaultAccounts(f.repository);

    const accounts = await f.accountService.listByProvider('psagot');
    expect(accounts).toHaveLength(1);
  });

  // MG2c: ensureDefaultAccounts skips providers that already have accounts
  it('MG2c: skips providers that already have non-default accounts', async () => {
    const f = makeFixture();
    await f.repository.upsertProvider(f.provider);

    await f.accountService.createAccount({ id: 'my-account', providerId: 'psagot', name: 'My Account' });

    await ensureDefaultAccounts(f.repository);

    const accounts = await f.accountService.listByProvider('psagot');
    // Should only have the manually created account, no extra "default"
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('my-account');
  });

  // MG3: Re-import into default account -> dedup works against migrated records
  it('MG3: re-import into default deduplicates against migrated records', async () => {
    const f = makeFixture();
    await seedFixture(f);

    // Write R2 records + run directly
    // R2 records already have costBasis in ILS (post-agorot-conversion), e.g. 50 ILS
    await f.store.writeRawRecords('portfolio-holding-records.v1', [
      r2HoldingRecord('lot-1', 'AAA', 100, 50),
    ]);
    await f.store.writeRawRecords('portfolio-import-runs.v1', [
      r2ImportRun('run-legacy'),
    ]);

    // CSV with agorot costBasis: 5000 agorot = 50 ILS after conversion
    const csv = [CSV_HEADER, csvRow('AAA', 'AAA Corp', 100, 5000, '15/01/2026')].join('\n');
    const preview = await f.importService.previewImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      csvText: csv,
      accountId: 'default',
    });

    expect(preview.duplicateRows).toHaveLength(1);
    expect(preview.validRows).toHaveLength(0);
  });

  // MG4: Records that already have accountId -> not overwritten with "default"
  it('MG4: records with existing accountId are not overwritten', async () => {
    const f = makeFixture();

    // Mix of records: some with accountId, some without
    await f.store.writeRawRecords('portfolio-holding-records.v1', [
      { ...r2HoldingRecord('lot-1', 'AAA', 100, 50), accountId: 'my-account' },
      r2HoldingRecord('lot-2', 'BBB', 200, 30), // no accountId
    ]);

    const records = await f.repository.listHoldingRecordsByProvider('psagot');
    const lot1 = records.find((r) => r.id === 'lot-1')!;
    const lot2 = records.find((r) => r.id === 'lot-2')!;

    expect(lot1.accountId).toBe('my-account');
    expect(lot2.accountId).toBe('default');
  });

  // MG5: After on-write migration (re-import), record persisted with accountId
  it('MG5: re-import writes accountId to storage', async () => {
    const f = makeFixture();
    await seedFixture(f);

    // Write R2 records without accountId
    await f.store.writeRawRecords('portfolio-holding-records.v1', [
      r2HoldingRecord('lot-1', 'AAA', 100, 5000),
    ]);
    await f.store.writeRawRecords('portfolio-import-runs.v1', [
      r2ImportRun('run-legacy'),
    ]);

    // Re-import with updated quantity -> on-write migration
    const csv = [CSV_HEADER, csvRow('AAA', 'AAA Corp', 120, 5000, '15/01/2026')].join('\n');
    await f.importService.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 're-import.csv',
      csvText: csv,
      accountId: 'default',
    });

    // Read raw storage to verify accountId is now persisted
    const raw = await f.store.getItem('portfolio-holding-records.v1');
    const stored = JSON.parse(raw!) as Array<{ id: string; accountId?: string }>;
    const activeRecords = stored.filter((r) => r.accountId === 'default');
    expect(activeRecords.length).toBeGreaterThan(0);
  });

  // MG-regression: R2 records aggregate correctly through the full pipeline
  it('R2 records aggregate correctly after on-read migration', async () => {
    const f = makeFixture();

    await f.store.writeRawRecords('portfolio-holding-records.v1', [
      r2HoldingRecord('lot-1', 'AAA', 100, 50),
      r2HoldingRecord('lot-2', 'AAA', 50, 60),
    ]);
    await f.store.writeRawRecords('portfolio-import-runs.v1', [
      r2ImportRun('run-legacy'),
    ]);

    const state = await f.holdingsBuilder.build({ providerId: 'psagot' });
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0].quantity).toBe(150);
    expect(state.positions[0].accountIds).toEqual(['default']);
  });
});
