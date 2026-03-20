import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import { TelemetryService, type TelemetryEvent, type TelemetrySink } from '../src/telemetry';
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

class SpySink implements TelemetrySink {
  readonly events: TelemetryEvent[] = [];
  emit(event: TelemetryEvent): void {
    this.events.push(event);
  }
}

const PROVIDER_ID = 'provider-test';
const INTEGRATION_ID = 'integration-test-holdings';

function makeTelemetryFixture() {
  const repository = new LocalPortfolioRepository(new InMemoryStore());
  const spy = new SpySink();
  const telemetry = new TelemetryService(spy);
  const service = new PortfolioImportService(repository, telemetry);

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
    id: 'profile-test-v1',
    providerId: PROVIDER_ID,
    providerIntegrationId: INTEGRATION_ID,
    name: 'Test Holdings CSV',
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
    createdAt: now,
    updatedAt: now,
  };

  async function seed() {
    await repository.upsertProvider({
      id: PROVIDER_ID,
      name: 'Test Provider',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);
  }

  return { service, spy, seed };
}

const CSV = [
  'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","69,058.60",ש"ח,31/07/2025,"97,410.00"',
].join('\n');

describe('Telemetry baseline (S1-09)', () => {
  it('emits import.preview event on successful preview', async () => {
    const { service, spy, seed } = makeTelemetryFixture();
    await seed();

    await service.previewImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      csvText: CSV,
    });

    expect(spy.events).toHaveLength(1);
    expect(spy.events[0].name).toBe('import.preview');
    expect(spy.events[0].properties).toEqual({
      providerId: PROVIDER_ID,
      validCount: 1,
      invalidCount: 0,
      duplicateCount: 0,
    });
    expect(spy.events[0].timestamp).toBeDefined();
  });

  it('emits import.commit event on successful commit', async () => {
    const { service, spy, seed } = makeTelemetryFixture();
    await seed();

    const result = await service.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'test.csv',
      csvText: CSV,
    });

    // commit internally calls preview (emits preview event) then commit event
    const commitEvent = spy.events.find((e) => e.name === 'import.commit');
    expect(commitEvent).toBeDefined();
    expect(commitEvent!.properties).toMatchObject({
      providerId: PROVIDER_ID,
      runId: result.importRun.id,
      importedCount: 1,
      skippedCount: 0,
      errorCount: 0,
    });
  });

  it('emits import.undo event on successful undo', async () => {
    const { service, spy, seed } = makeTelemetryFixture();
    await seed();

    const commit = await service.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'test.csv',
      csvText: CSV,
    });

    spy.events.length = 0; // clear prior events

    await service.undoLastImport(INTEGRATION_ID);

    expect(spy.events).toHaveLength(1);
    expect(spy.events[0].name).toBe('import.undo');
    expect(spy.events[0].properties).toEqual({
      runId: commit.importRun.id,
    });
  });

  it('emits import.error event on failed preview', async () => {
    const { service, spy, seed } = makeTelemetryFixture();
    await seed();

    const badCsv = 'WrongHeader1,WrongHeader2\nval1,val2';

    await expect(
      service.previewImport({
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        csvText: badCsv,
      }),
    ).rejects.toThrow('Pattern fit failed');

    expect(spy.events).toHaveLength(1);
    expect(spy.events[0].name).toBe('import.error');
    expect(spy.events[0].properties?.operation).toBe('previewImport');
    expect(spy.events[0].properties?.error).toContain('Pattern fit failed');
  });

  it('works without telemetry (optional parameter)', async () => {
    const repository = new LocalPortfolioRepository(new InMemoryStore());
    const serviceNoTelemetry = new PortfolioImportService(repository);

    const now = new Date().toISOString();
    await repository.upsertProvider({
      id: PROVIDER_ID,
      name: 'Test',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await repository.upsertIntegration({
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
    });
    await repository.upsertMappingProfile({
      id: 'profile-v1',
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      name: 'Test',
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
      },
      requiredCanonicalFields: ['securityId', 'securityName', 'actionType', 'quantity', 'costBasis', 'currency', 'actionDate'],
      createdAt: now,
      updatedAt: now,
    });

    // Should work fine without telemetry — no errors
    const preview = await serviceNoTelemetry.previewImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      csvText: CSV,
    });
    expect(preview.validRows).toHaveLength(1);
  });
});
