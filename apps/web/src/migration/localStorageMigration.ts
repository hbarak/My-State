import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Provider,
  Account,
  ProviderIntegration,
  ProviderMappingProfile,
  ProviderAccountMapping,
  ProviderSymbolMapping,
  PortfolioImportRun,
  RawImportRow,
  TradeTransaction,
  ProviderHoldingRecord,
  PositionLot,
  TickerMapping,
} from '@my-stocks/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MIGRATION_FLAG_KEY = 'my-stocks:web:supabase-migration-v1:done';
const BATCH_SIZE = 500;
export const MIGRATION_TOTAL_STEPS = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Flag helpers
// ─────────────────────────────────────────────────────────────────────────────

export function hasMigrationCompleted(): boolean {
  return window.localStorage.getItem(MIGRATION_FLAG_KEY) === 'true';
}

function markMigrationComplete(): void {
  window.localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
}

// ─────────────────────────────────────────────────────────────────────────────
// Data detection
// ─────────────────────────────────────────────────────────────────────────────

export function hasLocalStorageData(): boolean {
  const keysThatIndicateData = [
    'my-stocks:web:providers.v1',
    'my-stocks:web:portfolio-holding-records.v1',
    'my-stocks:web:portfolio-import-runs.v1',
  ];
  return keysThatIndicateData.some((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length > 0;
    } catch {
      return false;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage read helpers
// ─────────────────────────────────────────────────────────────────────────────

function readBlob<T>(key: string): T[] {
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transforms
// ─────────────────────────────────────────────────────────────────────────────

function migrateAccountId(record: ProviderHoldingRecord): ProviderHoldingRecord {
  if (record.accountId) return record;
  return { ...record, accountId: 'default' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Row converters (camelCase → snake_case, inject user_id)
// ─────────────────────────────────────────────────────────────────────────────

function providerToRow(p: Provider, userId: string) {
  return { id: p.id, user_id: userId, name: p.name, status: p.status, created_at: p.createdAt, updated_at: p.updatedAt };
}

function accountToRow(a: Account, userId: string) {
  return { id: a.id, user_id: userId, provider_id: a.providerId, name: a.name, is_name_customized: a.isNameCustomized ?? null, created_at: a.createdAt, updated_at: a.updatedAt };
}

function integrationToRow(i: ProviderIntegration, userId: string) {
  return { id: i.id, user_id: userId, provider_id: i.providerId, kind: i.kind, data_domain: i.dataDomain, communication_method: i.communicationMethod, sync_mode: i.syncMode, direction: i.direction, adapter_key: i.adapterKey, mapping_profile_id: i.mappingProfileId ?? null, is_enabled: i.isEnabled, notes: i.notes ?? null, created_at: i.createdAt, updated_at: i.updatedAt };
}

function profileToRow(p: ProviderMappingProfile, userId: string) {
  return { id: p.id, user_id: userId, provider_id: p.providerId, provider_integration_id: p.providerIntegrationId, name: p.name, version: p.version, is_active: p.isActive, input_format: p.inputFormat, header_fingerprint: p.headerFingerprint ?? null, field_mappings: p.fieldMappings, required_canonical_fields: p.requiredCanonicalFields, optional_canonical_fields: p.optionalCanonicalFields ?? null, value_mappings: p.valueMappings ?? null, parsing_rules: p.parsingRules ?? null, created_at: p.createdAt, updated_at: p.updatedAt };
}

function accountMappingToRow(m: ProviderAccountMapping, userId: string) {
  return { id: m.id, user_id: userId, provider_id: m.providerId, provider_account_ref: m.providerAccountRef, account_id: m.accountId, created_at: m.createdAt, updated_at: m.updatedAt };
}

function symbolMappingToRow(m: ProviderSymbolMapping, userId: string) {
  return { id: m.id, user_id: userId, provider_id: m.providerId, provider_symbol: m.providerSymbol, symbol: m.symbol, display_symbol: m.displaySymbol, created_at: m.createdAt, updated_at: m.updatedAt };
}

function importRunToRow(r: PortfolioImportRun, userId: string) {
  return { id: r.id, user_id: userId, provider_id: r.providerId, provider_integration_id: r.providerIntegrationId, account_id: r.accountId ?? null, source_name: r.sourceName, status: r.status, started_at: r.startedAt, finished_at: r.finishedAt ?? null, imported_count: r.importedCount, skipped_count: r.skippedCount, error_count: r.errorCount, is_undoable: r.isUndoable, undone_at: r.undoneAt ?? null, error_message: r.errorMessage ?? null };
}

function rawRowToRow(r: RawImportRow, userId: string) {
  return { id: r.id, user_id: userId, import_run_id: r.importRunId, provider_id: r.providerId, provider_integration_id: r.providerIntegrationId, row_number: r.rowNumber, row_payload: r.rowPayload, row_hash: r.rowHash, is_valid: r.isValid, error_code: r.errorCode ?? null, error_message: r.errorMessage ?? null, created_at: r.createdAt };
}

function tradeToRow(t: TradeTransaction, userId: string) {
  return { id: t.id, user_id: userId, provider_id: t.providerId, provider_integration_id: t.providerIntegrationId, import_run_id: t.importRunId ?? null, account_id: t.accountId, symbol: t.symbol, display_symbol: t.displaySymbol, external_trade_id: t.externalTradeId ?? null, side: t.side, quantity: t.quantity, price: t.price, fees: t.fees, currency: t.currency, trade_at: t.tradeAt, note: t.note ?? null, created_at: t.createdAt, updated_at: t.updatedAt, deleted_at: t.deletedAt ?? null };
}

function holdingRecordToRow(r: ProviderHoldingRecord, userId: string) {
  return { id: r.id, user_id: userId, provider_id: r.providerId, provider_integration_id: r.providerIntegrationId, import_run_id: r.importRunId ?? null, account_id: r.accountId, security_id: r.securityId, security_name: r.securityName, action_type: r.actionType, quantity: r.quantity, cost_basis: r.costBasis, currency: r.currency, action_date: r.actionDate, current_price: r.currentPrice ?? null, created_at: r.createdAt, updated_at: r.updatedAt, deleted_at: r.deletedAt ?? null };
}

function lotToRow(l: PositionLot, userId: string) {
  return { id: l.id, user_id: userId, provider_id: l.providerId, account_id: l.accountId, symbol: l.symbol, buy_trade_id: l.buyTradeId, original_qty: l.originalQty, open_qty: l.openQty, cost_per_unit: l.costPerUnit, fees_allocated: l.feesAllocated, opened_at: l.openedAt, updated_at: l.updatedAt, closed_at: l.closedAt ?? null };
}

function tickerMappingToRow(m: TickerMapping, userId: string) {
  return { user_id: userId, security_id: m.securityId, security_name: m.securityName, ticker: m.ticker, exchange: m.exchange ?? null, resolved_at: m.resolvedAt, resolved_by: m.resolvedBy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch upsert helper
// ─────────────────────────────────────────────────────────────────────────────

async function upsertInBatches(
  client: SupabaseClient,
  table: string,
  rows: unknown[],
  onConflict: string,
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await client.from(table).upsert(chunk as Record<string, unknown>[], { onConflict });
    if (error) {
      throw new Error(`Migration failed at table '${table}' chunk ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main migration function
// ─────────────────────────────────────────────────────────────────────────────

export async function runMigration(
  client: SupabaseClient,
  userId: string,
  onProgress: (step: number, total: number) => void,
): Promise<void> {
  // Read all 12 blobs from localStorage
  const providers = readBlob<Provider>('my-stocks:web:providers.v1');
  const accounts = readBlob<Account>('my-stocks:web:accounts.v1');
  const integrations = readBlob<ProviderIntegration>('my-stocks:web:provider-integrations.v1');
  const profiles = readBlob<ProviderMappingProfile>('my-stocks:web:provider-mapping-profiles.v1');
  const accountMappings = readBlob<ProviderAccountMapping>('my-stocks:web:provider-account-mappings.v1');
  const symbolMappings = readBlob<ProviderSymbolMapping>('my-stocks:web:provider-symbol-mappings.v1');
  const importRuns = readBlob<PortfolioImportRun>('my-stocks:web:portfolio-import-runs.v1');
  const rawRows = readBlob<RawImportRow>('my-stocks:web:portfolio-raw-rows.v1');
  const trades = readBlob<TradeTransaction>('my-stocks:web:portfolio-trades.v1');
  const holdingRecords = readBlob<ProviderHoldingRecord>('my-stocks:web:portfolio-holding-records.v1');
  const lots = readBlob<PositionLot>('my-stocks:web:portfolio-lots.v1');
  const tickerMappings = readBlob<TickerMapping>('my-stocks:web:ticker-mappings.v1');

  // Step 1: providers
  await upsertInBatches(client, 'providers', providers.map(p => providerToRow(p, userId)), 'id,user_id');
  onProgress(1, MIGRATION_TOTAL_STEPS);

  // Step 2: accounts
  await upsertInBatches(client, 'accounts', accounts.map(a => accountToRow(a, userId)), 'user_id,provider_id,id');
  onProgress(2, MIGRATION_TOTAL_STEPS);

  // Step 3: provider_integrations
  await upsertInBatches(client, 'provider_integrations', integrations.map(i => integrationToRow(i, userId)), 'id,user_id');
  onProgress(3, MIGRATION_TOTAL_STEPS);

  // Step 4: provider_mapping_profiles
  await upsertInBatches(client, 'provider_mapping_profiles', profiles.map(p => profileToRow(p, userId)), 'id,user_id');
  onProgress(4, MIGRATION_TOTAL_STEPS);

  // Step 5: provider_account_mappings
  await upsertInBatches(client, 'provider_account_mappings', accountMappings.map(m => accountMappingToRow(m, userId)), 'user_id,provider_id,provider_account_ref');
  onProgress(5, MIGRATION_TOTAL_STEPS);

  // Step 6: provider_symbol_mappings
  await upsertInBatches(client, 'provider_symbol_mappings', symbolMappings.map(m => symbolMappingToRow(m, userId)), 'user_id,provider_id,provider_symbol');
  onProgress(6, MIGRATION_TOTAL_STEPS);

  // Step 7: portfolio_import_runs
  await upsertInBatches(client, 'portfolio_import_runs', importRuns.map(r => importRunToRow(r, userId)), 'id,user_id');
  onProgress(7, MIGRATION_TOTAL_STEPS);

  // Step 8: raw_import_rows
  await upsertInBatches(client, 'raw_import_rows', rawRows.map(r => rawRowToRow(r, userId)), 'id,user_id');
  onProgress(8, MIGRATION_TOTAL_STEPS);

  // Step 9: trade_transactions
  await upsertInBatches(client, 'trade_transactions', trades.map(t => tradeToRow(t, userId)), 'id,user_id');
  onProgress(9, MIGRATION_TOTAL_STEPS);

  // Step 10: provider_holding_records (apply migrateAccountId transform)
  const migratedHoldings = holdingRecords.map(migrateAccountId);
  await upsertInBatches(client, 'provider_holding_records', migratedHoldings.map(r => holdingRecordToRow(r, userId)), 'id,user_id');
  onProgress(10, MIGRATION_TOTAL_STEPS);

  // Step 11: position_lots
  await upsertInBatches(client, 'position_lots', lots.map(l => lotToRow(l, userId)), 'id,user_id');
  onProgress(11, MIGRATION_TOTAL_STEPS);

  // Step 12: ticker_mappings
  await upsertInBatches(client, 'ticker_mappings', tickerMappings.map(m => tickerMappingToRow(m, userId)), 'user_id,security_id');
  onProgress(12, MIGRATION_TOTAL_STEPS);

  // Only write flag after all 12 tables succeed
  markMigrationComplete();
}
