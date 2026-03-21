import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import type { Provider, ProviderIntegration, ProviderMappingProfile, ProviderHoldingRecord } from '../src/types';

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

const PSAGOT_CSV_HEADER = 'מספר ני"ע,שם ני"ע,סוג פעולה,כמות,שער עלות,מטבע,תאריך פעולה,שער נוכחי';

function csvRow(securityId: string, qty: number, costBasis: number, date: string): string {
  return `${securityId},Security ${securityId},קניה,${qty},${costBasis},ש"ח,${date},100`;
}

function makePsagotFixture() {
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

async function seedFixture(fixture: ReturnType<typeof makePsagotFixture>) {
  await fixture.repository.upsertProvider(fixture.provider);
  await fixture.repository.upsertIntegration(fixture.integration);
  await fixture.repository.upsertMappingProfile(fixture.profile);
}

describe('Identity Key — Account Scoping (S3-DEV-02)', () => {
  // IK1: Same lot data in different accounts -> different keys (not duplicates)
  it('same lot in different accounts produces separate records, not duplicates', async () => {
    const fixture = makePsagotFixture();
    await seedFixture(fixture);

    const csv = [PSAGOT_CSV_HEADER, csvRow('AAA', 100, 5000, '01/01/2026')].join('\n');

    // Import for account A
    await fixture.service.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'a.csv',
      csvText: csv,
      accountId: 'account-a',
    });

    // Import same CSV for account B
    await fixture.service.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'b.csv',
      csvText: csv,
      accountId: 'account-b',
    });

    // Should have 2 separate records (not treated as duplicate)
    const records = await fixture.repository.listHoldingRecordsByProvider('psagot');
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.accountId).sort()).toEqual(['account-a', 'account-b']);
  });

  // IK2: Records with accountId "default" produce backward-compatible keys
  it('records with accountId "default" are distinct from other accounts', async () => {
    const fixture = makePsagotFixture();
    await seedFixture(fixture);

    const csv = [PSAGOT_CSV_HEADER, csvRow('BBB', 50, 2000, '15/02/2026')].join('\n');

    // Import for default account
    await fixture.service.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'default.csv',
      csvText: csv,
      accountId: 'default',
    });

    // Import for named account
    await fixture.service.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'named.csv',
      csvText: csv,
      accountId: 'my-account',
    });

    const records = await fixture.repository.listHoldingRecordsByProvider('psagot');
    expect(records).toHaveLength(2);
  });

  // IK3: Composite key for dedup includes accountId — duplicate detection is per-account
  it('duplicate detection is scoped per account', async () => {
    const fixture = makePsagotFixture();
    await seedFixture(fixture);

    const csv = [PSAGOT_CSV_HEADER, csvRow('CCC', 200, 8000, '10/03/2026')].join('\n');

    // Import for account A
    await fixture.service.commitImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      sourceName: 'first.csv',
      csvText: csv,
      accountId: 'account-a',
    });

    // Preview same CSV for account A -> should show as duplicate
    const previewA = await fixture.service.previewImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      csvText: csv,
      accountId: 'account-a',
    });
    expect(previewA.duplicateRows).toHaveLength(1);
    expect(previewA.validRows).toHaveLength(0);

    // Preview same CSV for account B -> should NOT be duplicate
    const previewB = await fixture.service.previewImport({
      providerId: 'psagot',
      providerIntegrationId: 'psagot-holdings-csv',
      csvText: csv,
      accountId: 'account-b',
    });
    expect(previewB.duplicateRows).toHaveLength(0);
    expect(previewB.validRows).toHaveLength(1);
  });
});
