import {
  Account,
  PortfolioImportRun,
  PositionLot,
  Provider,
  ProviderAccountMapping,
  ProviderIntegration,
  ProviderMappingProfile,
  ProviderSymbolMapping,
  ProviderHoldingRecord,
  RawImportRow,
  TickerMapping,
  TradeTransaction,
} from '../types';

const KEYS = {
  providers: 'providers.v1',
  integrations: 'provider-integrations.v1',
  mappingProfiles: 'provider-mapping-profiles.v1',
  accountMappings: 'provider-account-mappings.v1',
  symbolMappings: 'provider-symbol-mappings.v1',
  importRuns: 'portfolio-import-runs.v1',
  rawRows: 'portfolio-raw-rows.v1',
  trades: 'portfolio-trades.v1',
  holdingRecords: 'portfolio-holding-records.v1',
  lots: 'portfolio-lots.v1',
  tickerMappings: 'ticker-mappings.v1',
  accounts: 'accounts.v1',
};

export interface JsonStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface ImportRunProvenance {
  readonly runId: string;
  readonly importDate: string;
  readonly accountId: string;
  readonly lotCount: number;
}

export interface PortfolioRepository {
  upsertAccount(account: Account): Promise<void>;
  getAccount(providerId: string, accountId: string): Promise<Account | null>;
  listAccountsByProvider(providerId: string): Promise<Account[]>;
  deleteAccount(providerId: string, accountId: string): Promise<void>;
  upsertProvider(provider: Provider): Promise<void>;
  getProviders(): Promise<Provider[]>;
  upsertIntegration(integration: ProviderIntegration): Promise<void>;
  getIntegrationById(integrationId: string): Promise<ProviderIntegration | null>;
  listIntegrations(providerId: string): Promise<ProviderIntegration[]>;
  upsertMappingProfile(profile: ProviderMappingProfile): Promise<void>;
  getActiveMappingProfile(providerIntegrationId: string): Promise<ProviderMappingProfile | null>;
  listMappingProfiles(providerIntegrationId: string): Promise<ProviderMappingProfile[]>;
  upsertAccountMapping(mapping: ProviderAccountMapping): Promise<void>;
  listAccountMappings(providerId: string): Promise<ProviderAccountMapping[]>;
  getAccountMapping(providerId: string, providerAccountRef: string): Promise<ProviderAccountMapping | null>;
  upsertSymbolMapping(mapping: ProviderSymbolMapping): Promise<void>;
  getSymbolMapping(providerId: string, providerSymbol: string): Promise<ProviderSymbolMapping | null>;
  addImportRun(run: PortfolioImportRun): Promise<void>;
  updateImportRun(run: PortfolioImportRun): Promise<void>;
  updateImportRunAccountId(oldAccountId: string, newAccountId: string, providerId: string): Promise<number>;
  listImportRuns(): Promise<PortfolioImportRun[]>;
  listImportRunsByProvider(providerId: string): Promise<PortfolioImportRun[]>;
  getLastSuccessfulImportRun(providerIntegrationId: string): Promise<PortfolioImportRun | null>;
  addRawRows(rows: RawImportRow[]): Promise<void>;
  listRawRowsByImportRun(importRunId: string): Promise<RawImportRow[]>;
  upsertTrades(trades: TradeTransaction[]): Promise<void>;
  upsertHoldingRecords(records: ProviderHoldingRecord[]): Promise<void>;
  listHoldingRecords(): Promise<ProviderHoldingRecord[]>;
  listHoldingRecordsByProvider(providerId: string): Promise<ProviderHoldingRecord[]>;
  listHoldingRecordsByAccount(providerId: string, accountId: string): Promise<ProviderHoldingRecord[]>;
  listHoldingRecordsByImportRun(importRunId: string): Promise<ProviderHoldingRecord[]>;
  /** Soft-deletes all holding records for the given run and marks the run as undone. */
  deleteImportRunContribution(runId: string): Promise<void>;
  /** Returns provenance entries for a security — one entry per contributing import run. */
  getProvenanceForSecurity(securityId: string): Promise<readonly ImportRunProvenance[]>;
  /** Wipes all import data: holding records, import runs, raw rows, and ticker mappings.
   *  Configuration (providers, integrations, mapping profiles) is preserved. */
  resetAllData(): Promise<void>;
  listTradesByProvider(providerId: string): Promise<TradeTransaction[]>;
  listTradesByAccount(providerId: string, accountId: string): Promise<TradeTransaction[]>;
  listTradesByIntegration(providerIntegrationId: string): Promise<TradeTransaction[]>;
  listTradesByImportRun(importRunId: string): Promise<TradeTransaction[]>;
  listTradesByAccountSymbol(accountId: string, symbol: string): Promise<TradeTransaction[]>;
  replaceLots(lots: PositionLot[]): Promise<void>;
  listLotsByAccountSymbol(accountId: string, symbol: string): Promise<PositionLot[]>;
  upsertTickerMapping(mapping: TickerMapping): Promise<void>;
  getTickerMapping(securityId: string): Promise<TickerMapping | null>;
  listTickerMappings(): Promise<TickerMapping[]>;
  deleteTickerMapping(securityId: string): Promise<void>;
}

export class LocalPortfolioRepository implements PortfolioRepository {
  constructor(private readonly store: JsonStore) {}

  async upsertAccount(account: Account): Promise<void> {
    const list = await this.getList<Account>(KEYS.accounts);
    const next = upsertByUniqueKey(
      list,
      account,
      (item) => `${item.providerId}:${item.id}`,
      () => `${account.providerId}:${account.id}`,
    );
    await this.setList(KEYS.accounts, next);
  }

  async getAccount(providerId: string, accountId: string): Promise<Account | null> {
    const list = await this.getList<Account>(KEYS.accounts);
    return list.find((item) => item.providerId === providerId && item.id === accountId) ?? null;
  }

  async listAccountsByProvider(providerId: string): Promise<Account[]> {
    const list = await this.getList<Account>(KEYS.accounts);
    return list.filter((item) => item.providerId === providerId);
  }

  async deleteAccount(providerId: string, accountId: string): Promise<void> {
    const list = await this.getList<Account>(KEYS.accounts);
    const next = list.filter((item) => !(item.providerId === providerId && item.id === accountId));
    await this.setList(KEYS.accounts, next);
  }

  async upsertProvider(provider: Provider): Promise<void> {
    const list = await this.getList<Provider>(KEYS.providers);
    const next = upsertById(list, provider);
    await this.setList(KEYS.providers, next);
  }

  getProviders(): Promise<Provider[]> {
    return this.getList<Provider>(KEYS.providers);
  }

  async upsertIntegration(integration: ProviderIntegration): Promise<void> {
    const list = await this.getList<ProviderIntegration>(KEYS.integrations);
    const next = upsertById(list, integration);
    await this.setList(KEYS.integrations, next);
  }

  async getIntegrationById(integrationId: string): Promise<ProviderIntegration | null> {
    const list = await this.getList<ProviderIntegration>(KEYS.integrations);
    return list.find((item) => item.id === integrationId) ?? null;
  }

  async listIntegrations(providerId: string): Promise<ProviderIntegration[]> {
    const list = await this.getList<ProviderIntegration>(KEYS.integrations);
    return list.filter((item) => item.providerId === providerId);
  }

  async upsertMappingProfile(profile: ProviderMappingProfile): Promise<void> {
    const list = await this.getList<ProviderMappingProfile>(KEYS.mappingProfiles);
    const next = upsertById(list, profile);
    await this.setList(KEYS.mappingProfiles, next);
  }

  async getActiveMappingProfile(providerIntegrationId: string): Promise<ProviderMappingProfile | null> {
    const list = await this.getList<ProviderMappingProfile>(KEYS.mappingProfiles);
    const active = list
      .filter((item) => item.providerIntegrationId === providerIntegrationId && item.isActive)
      .sort((a, b) => b.version - a.version);
    return active[0] ?? null;
  }

  async listMappingProfiles(providerIntegrationId: string): Promise<ProviderMappingProfile[]> {
    const list = await this.getList<ProviderMappingProfile>(KEYS.mappingProfiles);
    return list
      .filter((item) => item.providerIntegrationId === providerIntegrationId)
      .sort((a, b) => b.version - a.version);
  }

  async upsertAccountMapping(mapping: ProviderAccountMapping): Promise<void> {
    const list = await this.getList<ProviderAccountMapping>(KEYS.accountMappings);
    const next = upsertByUniqueKey(
      list,
      mapping,
      (item) => `${item.providerId}:${item.providerAccountRef}`,
      () => `${mapping.providerId}:${mapping.providerAccountRef}`,
    );
    await this.setList(KEYS.accountMappings, next);
  }

  async getAccountMapping(providerId: string, providerAccountRef: string): Promise<ProviderAccountMapping | null> {
    const list = await this.getList<ProviderAccountMapping>(KEYS.accountMappings);
    return list.find((item) => item.providerId === providerId && item.providerAccountRef === providerAccountRef) ?? null;
  }

  async listAccountMappings(providerId: string): Promise<ProviderAccountMapping[]> {
    const list = await this.getList<ProviderAccountMapping>(KEYS.accountMappings);
    return list.filter((item) => item.providerId === providerId);
  }

  async upsertSymbolMapping(mapping: ProviderSymbolMapping): Promise<void> {
    const list = await this.getList<ProviderSymbolMapping>(KEYS.symbolMappings);
    const next = upsertByUniqueKey(
      list,
      mapping,
      (item) => `${item.providerId}:${item.providerSymbol}`,
      () => `${mapping.providerId}:${mapping.providerSymbol}`,
    );
    await this.setList(KEYS.symbolMappings, next);
  }

  async getSymbolMapping(providerId: string, providerSymbol: string): Promise<ProviderSymbolMapping | null> {
    const list = await this.getList<ProviderSymbolMapping>(KEYS.symbolMappings);
    return list.find((item) => item.providerId === providerId && item.providerSymbol === providerSymbol) ?? null;
  }

  async addImportRun(run: PortfolioImportRun): Promise<void> {
    const list = await this.getList<PortfolioImportRun>(KEYS.importRuns);
    await this.setList(KEYS.importRuns, [run, ...list]);
  }

  async updateImportRun(run: PortfolioImportRun): Promise<void> {
    const list = await this.getList<PortfolioImportRun>(KEYS.importRuns);
    await this.setList(KEYS.importRuns, upsertById(list, run));
  }

  async updateImportRunAccountId(oldAccountId: string, newAccountId: string, providerId: string): Promise<number> {
    const list = await this.getList<PortfolioImportRun>(KEYS.importRuns);
    let count = 0;
    const updated = list.map((run) => {
      if (run.providerId === providerId && run.accountId === oldAccountId) {
        count += 1;
        return { ...run, accountId: newAccountId };
      }
      return run;
    });
    await this.setList(KEYS.importRuns, updated);
    return count;
  }

  listImportRuns(): Promise<PortfolioImportRun[]> {
    return this.getList<PortfolioImportRun>(KEYS.importRuns);
  }

  async listImportRunsByProvider(providerId: string): Promise<PortfolioImportRun[]> {
    const list = await this.getList<PortfolioImportRun>(KEYS.importRuns);
    return list.filter((item) => item.providerId === providerId);
  }

  async getLastSuccessfulImportRun(providerIntegrationId: string): Promise<PortfolioImportRun | null> {
    const list = await this.getList<PortfolioImportRun>(KEYS.importRuns);
    const sorted = list
      .filter(
        (item) =>
          item.providerIntegrationId === providerIntegrationId &&
          item.status === 'success' &&
          !item.undoneAt,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return sorted[0] ?? null;
  }

  async addRawRows(rows: RawImportRow[]): Promise<void> {
    const list = await this.getList<RawImportRow>(KEYS.rawRows);
    await this.setList(KEYS.rawRows, [...rows, ...list]);
  }

  async listRawRowsByImportRun(importRunId: string): Promise<RawImportRow[]> {
    const list = await this.getList<RawImportRow>(KEYS.rawRows);
    return list.filter((item) => item.importRunId === importRunId);
  }

  async upsertTrades(trades: TradeTransaction[]): Promise<void> {
    const list = await this.getList<TradeTransaction>(KEYS.trades);
    let next = list;
    for (const trade of trades) {
      next = upsertById(next, trade);
    }
    await this.setList(KEYS.trades, next);
  }

  async upsertHoldingRecords(records: ProviderHoldingRecord[]): Promise<void> {
    const list = await this.getList<ProviderHoldingRecord>(KEYS.holdingRecords);
    let next = list;
    for (const record of records) {
      next = upsertById(next, record);
    }
    await this.setList(KEYS.holdingRecords, next);
  }

  async listHoldingRecords(): Promise<ProviderHoldingRecord[]> {
    const list = await this.getList<ProviderHoldingRecord>(KEYS.holdingRecords);
    return list.map(migrateAccountId);
  }

  async listHoldingRecordsByProvider(providerId: string): Promise<ProviderHoldingRecord[]> {
    const list = await this.getList<ProviderHoldingRecord>(KEYS.holdingRecords);
    return list
      .filter((item) => item.providerId === providerId && !item.deletedAt)
      .map(migrateAccountId);
  }

  async listHoldingRecordsByAccount(providerId: string, accountId: string): Promise<ProviderHoldingRecord[]> {
    const list = await this.getList<ProviderHoldingRecord>(KEYS.holdingRecords);
    return list
      .filter((item) => item.providerId === providerId && !item.deletedAt)
      .map(migrateAccountId)
      .filter((item) => item.accountId === accountId);
  }

  async listHoldingRecordsByImportRun(importRunId: string): Promise<ProviderHoldingRecord[]> {
    const list = await this.getList<ProviderHoldingRecord>(KEYS.holdingRecords);
    return list.filter((item) => item.importRunId === importRunId).map(migrateAccountId);
  }

  async deleteImportRunContribution(runId: string): Promise<void> {
    const now = new Date().toISOString();

    // Soft-delete all holding records for this run
    const records = await this.getList<ProviderHoldingRecord>(KEYS.holdingRecords);
    const updatedRecords = records.map((record) => {
      if (record.importRunId !== runId) return record;
      return { ...record, deletedAt: now, updatedAt: now };
    });
    await this.setList(KEYS.holdingRecords, updatedRecords);

    // Mark the import run as undone
    const runs = await this.getList<PortfolioImportRun>(KEYS.importRuns);
    const updatedRuns = runs.map((run) => {
      if (run.id !== runId) return run;
      return { ...run, isUndoable: false, undoneAt: now };
    });
    await this.setList(KEYS.importRuns, updatedRuns);
  }

  async getProvenanceForSecurity(securityId: string): Promise<readonly ImportRunProvenance[]> {
    const records = await this.getList<ProviderHoldingRecord>(KEYS.holdingRecords);
    const runs = await this.getList<PortfolioImportRun>(KEYS.importRuns);

    const runById = new Map(runs.map((r) => [r.id, r]));

    // Collect active (non-deleted) lots for this security, grouped by importRunId
    const lotCountByRunId = new Map<string, number>();
    for (const record of records) {
      if (record.securityId !== securityId) continue;
      if (record.deletedAt) continue;
      if (!record.importRunId) continue;
      lotCountByRunId.set(record.importRunId, (lotCountByRunId.get(record.importRunId) ?? 0) + 1);
    }

    const result: ImportRunProvenance[] = [];
    for (const [runId, lotCount] of lotCountByRunId.entries()) {
      const run = runById.get(runId);
      result.push({
        runId,
        importDate: run?.startedAt ?? '',
        accountId: run?.accountId ?? 'default',
        lotCount,
      });
    }

    return result.sort((a, b) => b.importDate.localeCompare(a.importDate));
  }

  async resetAllData(): Promise<void> {
    await this.setList(KEYS.holdingRecords, []);
    await this.setList(KEYS.importRuns, []);
    await this.setList(KEYS.rawRows, []);
    await this.setList(KEYS.tickerMappings, []);
    await this.setList(KEYS.trades, []);
    await this.setList(KEYS.lots, []);
  }

  async listTradesByProvider(providerId: string): Promise<TradeTransaction[]> {
    const list = await this.getList<TradeTransaction>(KEYS.trades);
    return list.filter((item) => item.providerId === providerId && !item.deletedAt);
  }

  async listTradesByAccount(providerId: string, accountId: string): Promise<TradeTransaction[]> {
    const list = await this.getList<TradeTransaction>(KEYS.trades);
    return list.filter((item) => item.providerId === providerId && item.accountId === accountId && !item.deletedAt);
  }

  async listTradesByIntegration(providerIntegrationId: string): Promise<TradeTransaction[]> {
    const list = await this.getList<TradeTransaction>(KEYS.trades);
    return list.filter((item) => item.providerIntegrationId === providerIntegrationId && !item.deletedAt);
  }

  async listTradesByImportRun(importRunId: string): Promise<TradeTransaction[]> {
    const list = await this.getList<TradeTransaction>(KEYS.trades);
    return list.filter((item) => item.importRunId === importRunId);
  }

  async listTradesByAccountSymbol(accountId: string, symbol: string): Promise<TradeTransaction[]> {
    const list = await this.getList<TradeTransaction>(KEYS.trades);
    return list
      .filter((item) => item.accountId === accountId && item.symbol === symbol && !item.deletedAt)
      .sort((a, b) => a.tradeAt.localeCompare(b.tradeAt));
  }

  async replaceLots(lots: PositionLot[]): Promise<void> {
    await this.setList(KEYS.lots, lots);
  }

  async listLotsByAccountSymbol(accountId: string, symbol: string): Promise<PositionLot[]> {
    const list = await this.getList<PositionLot>(KEYS.lots);
    return list.filter((item) => item.accountId === accountId && item.symbol === symbol);
  }

  async upsertTickerMapping(mapping: TickerMapping): Promise<void> {
    const list = await this.getList<TickerMapping>(KEYS.tickerMappings);
    const index = list.findIndex((item) => item.securityId === mapping.securityId);
    if (index < 0) {
      await this.setList(KEYS.tickerMappings, [mapping, ...list]);
    } else {
      const copy = [...list];
      copy[index] = mapping;
      await this.setList(KEYS.tickerMappings, copy);
    }
  }

  async getTickerMapping(securityId: string): Promise<TickerMapping | null> {
    const list = await this.getList<TickerMapping>(KEYS.tickerMappings);
    return list.find((item) => item.securityId === securityId) ?? null;
  }

  async listTickerMappings(): Promise<TickerMapping[]> {
    return this.getList<TickerMapping>(KEYS.tickerMappings);
  }

  async deleteTickerMapping(securityId: string): Promise<void> {
    const list = await this.getList<TickerMapping>(KEYS.tickerMappings);
    const next = list.filter((item) => item.securityId !== securityId);
    await this.setList(KEYS.tickerMappings, next);
  }

  private async getList<T>(key: string): Promise<T[]> {
    const raw = await this.store.getItem(key);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as T[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async setList<T>(key: string, list: T[]): Promise<void> {
    await this.store.setItem(key, JSON.stringify(list));
  }
}

/** On-read migration: assign accountId "default" to R2 records that lack it */
function migrateAccountId(record: ProviderHoldingRecord): ProviderHoldingRecord {
  if (record.accountId) return record;
  return { ...record, accountId: 'default' };
}

function upsertById<T extends { id: string }>(list: T[], value: T): T[] {
  const index = list.findIndex((item) => item.id === value.id);
  if (index < 0) return [value, ...list];

  const copy = [...list];
  copy[index] = value;
  return copy;
}

function upsertByUniqueKey<T>(
  list: T[],
  value: T,
  getCurrentKey: (item: T) => string,
  getTargetKey: () => string,
): T[] {
  const targetKey = getTargetKey();
  const index = list.findIndex((item) => getCurrentKey(item) === targetKey);
  if (index < 0) return [value, ...list];

  const copy = [...list];
  copy[index] = value;
  return copy;
}
