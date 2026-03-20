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

function makeFixture() {
  const repository = new LocalPortfolioRepository(new InMemoryStore());
  const service = new PortfolioImportService(repository);

  const provider: Provider = {
    id: 'provider-broker-a',
    name: 'Broker A',
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const integration: ProviderIntegration = {
    id: 'integration-broker-a-trades-csv',
    providerId: provider.id,
    kind: 'document',
    dataDomain: 'trades',
    communicationMethod: 'document_csv',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'csv.trades.v1',
    isEnabled: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const profile: ProviderMappingProfile = {
    id: 'profile-broker-a-v1',
    providerId: provider.id,
    providerIntegrationId: integration.id,
    name: 'Broker A Trades CSV v1',
    version: 1,
    isActive: true,
    inputFormat: 'csv',
    fieldMappings: {
      accountId: 'Account',
      symbol: 'Symbol',
      side: 'Side',
      quantity: 'Qty',
      price: 'Price',
      fees: 'Fees',
      currency: 'Currency',
      tradeAt: 'TradeDate',
      externalTradeId: 'ExternalTradeId',
    },
    requiredCanonicalFields: ['accountId', 'symbol', 'side', 'quantity', 'price', 'tradeAt'],
    optionalCanonicalFields: ['fees', 'currency', 'externalTradeId'],
    valueMappings: {
      side: {
        BUY: 'buy',
        SELL: 'sell',
      },
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const csv = [
    'Account,Symbol,Side,Qty,Price,Fees,Currency,TradeDate,ExternalTradeId',
    'acc_main,AAPL,BUY,10,188.30,1.2,USD,2026-02-18T09:30:00Z,tx-1001',
    'acc_main,AAPL,SELL,2,195.50,1.0,USD,2026-02-20T13:00:00Z,tx-1002',
    'acc_main,AAPL,BUY,0,190.00,0.5,USD,2026-02-21T10:00:00Z,tx-1003',
  ].join('\n');

  return { repository, service, provider, integration, profile, csv };
}

describe('PortfolioImportService', () => {
  it('previews valid/invalid rows and commits trades', async () => {
    const { repository, service, provider, integration, profile, csv } = makeFixture();

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    const preview = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      csvText: csv,
    });

    expect(preview.validRows).toHaveLength(2);
    expect(preview.invalidRows).toHaveLength(1);
    expect(preview.invalidRows[0]?.errorCode).toBe('INVALID_QUANTITY');

    const commit = await service.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'sample.csv',
      csvText: csv,
    });

    expect(commit.importedTrades).toBe(2);
    expect(commit.errorRows).toBe(1);
    expect(commit.skippedRows).toBe(0);
  });

  it('dedupes per provider across integrations', async () => {
    const { repository, service, provider, integration, profile, csv } = makeFixture();

    const integration2: ProviderIntegration = {
      ...integration,
      id: 'integration-broker-a-trades-csv-2',
      adapterKey: 'csv.trades.v2',
    };

    const profile2: ProviderMappingProfile = {
      ...profile,
      id: 'profile-broker-a-v2',
      providerIntegrationId: integration2.id,
      version: 2,
      isActive: true,
    };

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertIntegration(integration2);
    await repository.upsertMappingProfile(profile);
    await repository.upsertMappingProfile(profile2);

    await service.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'sample.csv',
      csvText: csv,
    });

    const previewFromOtherIntegration = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration2.id,
      csvText: csv,
    });

    expect(previewFromOtherIntegration.validRows).toHaveLength(0);
    expect(previewFromOtherIntegration.duplicateRows.length).toBeGreaterThan(0);
  });

  it('uses composite dedupe when externalTradeId is missing', async () => {
    const { repository, service, provider, integration, profile } = makeFixture();

    const profileNoExternal: ProviderMappingProfile = {
      ...profile,
      id: 'profile-no-external',
      fieldMappings: {
        accountId: 'Account',
        symbol: 'Symbol',
        side: 'Side',
        quantity: 'Qty',
        price: 'Price',
        fees: 'Fees',
        currency: 'Currency',
        tradeAt: 'TradeDate',
      },
      requiredCanonicalFields: ['accountId', 'symbol', 'side', 'quantity', 'price', 'tradeAt'],
      optionalCanonicalFields: ['fees', 'currency'],
    };

    const csv = [
      'Account,Symbol,Side,Qty,Price,Fees,Currency,TradeDate',
      'acc_main,MSFT,BUY,5,410.00,1.0,USD,2026-02-18T09:30:00Z',
      'acc_main,MSFT,BUY,5,410.00,1.0,USD,2026-02-18T09:30:00Z',
    ].join('\n');

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profileNoExternal);

    const firstPreview = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      csvText: csv,
    });
    expect(firstPreview.validRows).toHaveLength(2);

    await service.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'msft.csv',
      csvText: csv,
    });

    const secondPreview = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      csvText: csv,
    });
    expect(secondPreview.validRows).toHaveLength(0);
    expect(secondPreview.duplicateRows).toHaveLength(2);
  });

  it('fails preview when required mappings are missing', async () => {
    const { repository, service, provider, integration, profile, csv } = makeFixture();
    const brokenProfile: ProviderMappingProfile = {
      ...profile,
      id: 'profile-broken',
      fieldMappings: {
        ...profile.fieldMappings,
        tradeAt: '',
      },
    };

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(brokenProfile);

    await expect(
      service.previewImport({
        providerId: provider.id,
        providerIntegrationId: integration.id,
        csvText: csv,
      }),
    ).rejects.toThrow('missing required field mappings');
  });

  it('fails preview when CSV does not satisfy required header fit-check', async () => {
    const { repository, service, provider, integration, profile } = makeFixture();
    const csvMissingRequiredHeader = [
      'Account,Symbol,Side,Qty,Price,Currency,ExternalTradeId',
      'acc_main,AAPL,BUY,1,188.30,USD,tx-1111',
    ].join('\n');

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    await expect(
      service.previewImport({
        providerId: provider.id,
        providerIntegrationId: integration.id,
        csvText: csvMissingRequiredHeader,
      }),
    ).rejects.toThrow('Pattern fit failed');
  });

  it('fails on provider/integration mismatch', async () => {
    const { repository, service, provider, integration, profile, csv } = makeFixture();

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    await expect(
      service.previewImport({
        providerId: 'another-provider',
        providerIntegrationId: integration.id,
        csvText: csv,
      }),
    ).rejects.toThrow('Provider and integration mismatch');
  });

  it('supports undo of last successful import', async () => {
    const { repository, service, provider, integration, profile, csv } = makeFixture();

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    const commit = await service.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'sample.csv',
      csvText: csv,
    });

    const beforeUndo = await repository.listTradesByImportRun(commit.importRun.id);
    expect(beforeUndo.length).toBe(2);
    expect(beforeUndo.every((trade) => !trade.deletedAt)).toBe(true);

    const undone = await service.undoLastImport(integration.id);
    expect(undone).not.toBeNull();
    expect(undone?.isUndoable).toBe(false);
    expect(undone?.undoneAt).toBeDefined();

    const afterUndo = await repository.listTradesByImportRun(commit.importRun.id);
    expect(afterUndo.every((trade) => Boolean(trade.deletedAt))).toBe(true);
  });

  it('stores raw rows for valid, invalid, and duplicate outcomes', async () => {
    const { repository, service, provider, integration, profile } = makeFixture();
    const csv = [
      'Account,Symbol,Side,Qty,Price,Fees,Currency,TradeDate,ExternalTradeId',
      'acc_main,AAPL,BUY,10,188.30,1.2,USD,2026-02-18T09:30:00Z,tx-3001',
      'acc_main,AAPL,BUY,10,188.30,1.2,USD,2026-02-18T09:30:00Z,tx-3001',
      'acc_main,AAPL,SELL,0,195.50,1.0,USD,2026-02-20T13:00:00Z,tx-3002',
    ].join('\n');

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    const commit = await service.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'mixed.csv',
      csvText: csv,
    });

    const rows = await repository.listRawRowsByImportRun(commit.importRun.id);
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.errorCode === 'INVALID_QUANTITY')).toBe(true);
  });

  it('fails when integration domain is not trades', async () => {
    const { repository, service, provider, integration, profile, csv } = makeFixture();
    const cashIntegration: ProviderIntegration = {
      ...integration,
      id: 'integration-broker-a-cash-csv',
      dataDomain: 'cash_transactions',
    };
    const cashProfile: ProviderMappingProfile = {
      ...profile,
      id: 'profile-cash-v1',
      providerIntegrationId: cashIntegration.id,
    };

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(cashIntegration);
    await repository.upsertMappingProfile(cashProfile);

    await expect(
      service.previewImport({
        providerId: provider.id,
        providerIntegrationId: cashIntegration.id,
        csvText: csv,
      }),
    ).rejects.toThrow('Unsupported data domain');
  });

  it('fails when no active mapping profile exists', async () => {
    const { repository, service, provider, integration, profile, csv } = makeFixture();
    const inactiveProfile: ProviderMappingProfile = {
      ...profile,
      isActive: false,
    };

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(inactiveProfile);

    await expect(
      service.previewImport({
        providerId: provider.id,
        providerIntegrationId: integration.id,
        csvText: csv,
      }),
    ).rejects.toThrow('No active mapping profile');
  });

  it('requires mapped/known account when strict account mapping is enabled', async () => {
    const { repository, service, provider, integration, profile } = makeFixture();
    const strictProfile: ProviderMappingProfile = {
      ...profile,
      parsingRules: {
        requireAccountMapping: true,
      },
    };

    const csv = [
      'Account,Symbol,Side,Qty,Price,Fees,Currency,TradeDate,ExternalTradeId',
      'unknown_account,AAPL,BUY,1,188.30,1.2,USD,2026-02-18T09:30:00Z,tx-9901',
    ].join('\n');

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(strictProfile);

    const preview = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      csvText: csv,
    });

    expect(preview.validRows).toHaveLength(0);
    expect(preview.invalidRows).toHaveLength(1);
    expect(preview.invalidRows[0]?.errorCode).toBe('ACCOUNT_ID_UNRESOLVED');
  });

  it('parses quoted CSV fields containing commas', async () => {
    const { repository, service, provider, integration, profile } = makeFixture();
    const csv = [
      'Account,Symbol,Side,Qty,Price,Fees,Currency,TradeDate,ExternalTradeId,Note',
      'acc_main,AAPL,BUY,1,188.30,1.2,USD,2026-02-18T09:30:00Z,tx-9001,\"note, with comma\"',
    ].join('\n');

    const profileWithNote: ProviderMappingProfile = {
      ...profile,
      fieldMappings: {
        ...profile.fieldMappings,
        note: 'Note',
      },
      optionalCanonicalFields: ['fees', 'currency', 'externalTradeId', 'note'],
    };

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profileWithNote);

    const preview = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      csvText: csv,
    });

    expect(preview.validRows).toHaveLength(1);
    expect((preview.validRows[0]?.normalized as Record<string, unknown>)?.note).toBe('note, with comma');
  });

  it('ignores blank lines in CSV input', async () => {
    const { repository, service, provider, integration, profile } = makeFixture();
    const csv = [
      'Account,Symbol,Side,Qty,Price,Fees,Currency,TradeDate,ExternalTradeId',
      '',
      'acc_main,AAPL,BUY,1,188.30,1.2,USD,2026-02-18T09:30:00Z,tx-9101',
      '   ',
      'acc_main,AAPL,SELL,1,195.00,1.0,USD,2026-02-20T13:00:00Z,tx-9102',
    ].join('\n');

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    const preview = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      csvText: csv,
    });

    expect(preview.validRows).toHaveLength(2);
    expect(preview.invalidRows).toHaveLength(0);
  });

  it('imports Psagot holdings rows and normalizes date/numbers/html entities', async () => {
    const { repository, service, provider } = makeFixture();
    const integration: ProviderIntegration = {
      id: 'integration-psagot-holdings-csv',
      providerId: provider.id,
      kind: 'document',
      dataDomain: 'holdings',
      communicationMethod: 'document_csv',
      syncMode: 'manual',
      direction: 'ingest',
      adapterKey: 'psagot.holdings.csv.v1',
      isEnabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const profile: ProviderMappingProfile = {
      id: 'profile-psagot-holdings-v1',
      providerId: provider.id,
      providerIntegrationId: integration.id,
      name: 'Psagot Holdings CSV v1',
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
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const csv = [
      'מספר ני\"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
      '1183441,S&amp;P500 אינ.חוץ,העברה חיצונית לח-ן,\"39.00\",\"4,308.66\",ש\"ח,02/09/2025,\"4,257.00\"',
    ].join('\n');

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    const preview = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      csvText: csv,
    });

    expect(preview.validRows).toHaveLength(1);
    const normalized = preview.validRows[0]?.normalized as Record<string, unknown>;
    expect(normalized.securityName).toBe('S&P500 אינ.חוץ');
    expect(normalized.actionDate).toBe('2025-09-02');
    expect(normalized.quantity).toBe(39);
    expect(normalized.costBasis).toBeCloseTo(43.0866); // 4308.66 agorot / 100
    expect(normalized.currentPrice).toBeCloseTo(42.57); // 4257 agorot / 100

    const commit = await service.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'psagot.csv',
      csvText: csv,
    });
    expect(commit.importedTrades).toBe(1);
  });

  it('dedupes Psagot holdings rows by composite key including costBasis', async () => {
    const { repository, service, provider } = makeFixture();
    const integration: ProviderIntegration = {
      id: 'integration-psagot-holdings-csv-2',
      providerId: provider.id,
      kind: 'document',
      dataDomain: 'holdings',
      communicationMethod: 'document_csv',
      syncMode: 'manual',
      direction: 'ingest',
      adapterKey: 'psagot.holdings.csv.v1',
      isEnabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const profile: ProviderMappingProfile = {
      id: 'profile-psagot-holdings-v2',
      providerId: provider.id,
      providerIntegrationId: integration.id,
      name: 'Psagot Holdings CSV v1',
      version: 1,
      isActive: true,
      inputFormat: 'csv',
      fieldMappings: {
        securityId: 'SecurityId',
        securityName: 'SecurityName',
        actionType: 'ActionType',
        quantity: 'Quantity',
        costBasis: 'CostBasis',
        currency: 'Currency',
        actionDate: 'ActionDate',
      },
      requiredCanonicalFields: ['securityId', 'securityName', 'actionType', 'quantity', 'costBasis', 'currency', 'actionDate'],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const csv = [
      'SecurityId,SecurityName,ActionType,Quantity,CostBasis,Currency,ActionDate',
      '1183441,S&P500,העברה חיצונית לח-ן,39,4308.66,ILS,02/09/2025',
    ].join('\n');

    await repository.upsertProvider(provider);
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);

    await service.commitImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      sourceName: 'psagot1.csv',
      csvText: csv,
    });

    const previewAgain = await service.previewImport({
      providerId: provider.id,
      providerIntegrationId: integration.id,
      csvText: csv,
    });
    expect(previewAgain.validRows).toHaveLength(0);
    expect(previewAgain.duplicateRows).toHaveLength(1);
  });
});
