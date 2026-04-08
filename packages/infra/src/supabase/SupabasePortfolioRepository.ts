import type { SupabaseClient } from '@supabase/supabase-js';
import type { PortfolioRepository, ImportRunProvenance } from '@my-stocks/domain';
import type {
  Account,
  Provider,
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
// Row types (Postgres snake_case)
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderRow {
  id: string;
  user_id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface AccountRow {
  id: string;
  user_id: string;
  provider_id: string;
  name: string;
  is_name_customized: boolean | null;
  created_at: string;
  updated_at: string;
}

interface IntegrationRow {
  id: string;
  user_id: string;
  provider_id: string;
  kind: string;
  data_domain: string;
  communication_method: string;
  sync_mode: string;
  direction: string;
  adapter_key: string;
  mapping_profile_id: string | null;
  is_enabled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface MappingProfileRow {
  id: string;
  user_id: string;
  provider_id: string;
  provider_integration_id: string;
  name: string;
  version: number;
  is_active: boolean;
  input_format: string;
  header_fingerprint: string | null;
  field_mappings: Record<string, string>;
  required_canonical_fields: string[];
  optional_canonical_fields: string[] | null;
  value_mappings: Record<string, Record<string, string>> | null;
  parsing_rules: Record<string, string | number | boolean> | null;
  created_at: string;
  updated_at: string;
}

interface AccountMappingRow {
  id: string;
  user_id: string;
  provider_id: string;
  provider_account_ref: string;
  account_id: string;
  created_at: string;
  updated_at: string;
}

interface SymbolMappingRow {
  id: string;
  user_id: string;
  provider_id: string;
  provider_symbol: string;
  symbol: string;
  display_symbol: string;
  created_at: string;
  updated_at: string;
}

interface ImportRunRow {
  id: string;
  user_id: string;
  provider_id: string;
  provider_integration_id: string;
  account_id: string | null;
  source_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  is_undoable: boolean;
  undone_at: string | null;
  error_message: string | null;
}

interface RawRowRow {
  id: string;
  user_id: string;
  import_run_id: string;
  provider_id: string;
  provider_integration_id: string;
  row_number: number;
  row_payload: string;
  row_hash: string;
  is_valid: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

interface TradeRow {
  id: string;
  user_id: string;
  provider_id: string;
  provider_integration_id: string;
  import_run_id: string | null;
  account_id: string;
  symbol: string;
  display_symbol: string;
  external_trade_id: string | null;
  side: string;
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  trade_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface HoldingRecordRow {
  id: string;
  user_id: string;
  provider_id: string;
  provider_integration_id: string;
  import_run_id: string | null;
  account_id: string;
  security_id: string;
  security_name: string;
  action_type: string;
  quantity: number;
  cost_basis: number;
  currency: string;
  action_date: string;
  current_price: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface LotRow {
  id: string;
  user_id: string;
  provider_id: string;
  account_id: string;
  symbol: string;
  buy_trade_id: string;
  original_qty: number;
  open_qty: number;
  cost_per_unit: number;
  fees_allocated: number;
  opened_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface TickerMappingRow {
  user_id: string;
  security_id: string;
  security_name: string;
  ticker: string | null;
  exchange: string | null;
  resolved_at: string;
  resolved_by: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain ↔ Row converters
// ─────────────────────────────────────────────────────────────────────────────

function providerToRow(p: Provider, userId: string): ProviderRow {
  return {
    id: p.id,
    user_id: userId,
    name: p.name,
    status: p.status,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

function providerFromRow(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    status: row.status as Provider['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function accountToRow(a: Account, userId: string): AccountRow {
  return {
    id: a.id,
    user_id: userId,
    provider_id: a.providerId,
    name: a.name,
    is_name_customized: a.isNameCustomized ?? null,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

function accountFromRow(row: AccountRow): Account {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    isNameCustomized: row.is_name_customized ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function integrationToRow(i: ProviderIntegration, userId: string): IntegrationRow {
  return {
    id: i.id,
    user_id: userId,
    provider_id: i.providerId,
    kind: i.kind,
    data_domain: i.dataDomain,
    communication_method: i.communicationMethod,
    sync_mode: i.syncMode,
    direction: i.direction,
    adapter_key: i.adapterKey,
    mapping_profile_id: i.mappingProfileId ?? null,
    is_enabled: i.isEnabled,
    notes: i.notes ?? null,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
  };
}

function integrationFromRow(row: IntegrationRow): ProviderIntegration {
  return {
    id: row.id,
    providerId: row.provider_id,
    kind: row.kind as ProviderIntegration['kind'],
    dataDomain: row.data_domain as ProviderIntegration['dataDomain'],
    communicationMethod: row.communication_method as ProviderIntegration['communicationMethod'],
    syncMode: row.sync_mode as ProviderIntegration['syncMode'],
    direction: row.direction as ProviderIntegration['direction'],
    adapterKey: row.adapter_key,
    mappingProfileId: row.mapping_profile_id ?? undefined,
    isEnabled: row.is_enabled,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function profileToRow(p: ProviderMappingProfile, userId: string): MappingProfileRow {
  return {
    id: p.id,
    user_id: userId,
    provider_id: p.providerId,
    provider_integration_id: p.providerIntegrationId,
    name: p.name,
    version: p.version,
    is_active: p.isActive,
    input_format: p.inputFormat,
    header_fingerprint: p.headerFingerprint ?? null,
    field_mappings: p.fieldMappings,
    required_canonical_fields: p.requiredCanonicalFields,
    optional_canonical_fields: p.optionalCanonicalFields ?? null,
    value_mappings: p.valueMappings ?? null,
    parsing_rules: p.parsingRules ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

function profileFromRow(row: MappingProfileRow): ProviderMappingProfile {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerIntegrationId: row.provider_integration_id,
    name: row.name,
    version: row.version,
    isActive: row.is_active,
    inputFormat: row.input_format as ProviderMappingProfile['inputFormat'],
    headerFingerprint: row.header_fingerprint ?? undefined,
    fieldMappings: row.field_mappings,
    requiredCanonicalFields: row.required_canonical_fields,
    optionalCanonicalFields: row.optional_canonical_fields ?? undefined,
    valueMappings: row.value_mappings ?? undefined,
    parsingRules: row.parsing_rules ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function accountMappingToRow(m: ProviderAccountMapping, userId: string): AccountMappingRow {
  return {
    id: m.id,
    user_id: userId,
    provider_id: m.providerId,
    provider_account_ref: m.providerAccountRef,
    account_id: m.accountId,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

function accountMappingFromRow(row: AccountMappingRow): ProviderAccountMapping {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerAccountRef: row.provider_account_ref,
    accountId: row.account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function symbolMappingToRow(m: ProviderSymbolMapping, userId: string): SymbolMappingRow {
  return {
    id: m.id,
    user_id: userId,
    provider_id: m.providerId,
    provider_symbol: m.providerSymbol,
    symbol: m.symbol,
    display_symbol: m.displaySymbol,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

function symbolMappingFromRow(row: SymbolMappingRow): ProviderSymbolMapping {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerSymbol: row.provider_symbol,
    symbol: row.symbol,
    displaySymbol: row.display_symbol,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function importRunToRow(r: PortfolioImportRun, userId: string): ImportRunRow {
  return {
    id: r.id,
    user_id: userId,
    provider_id: r.providerId,
    provider_integration_id: r.providerIntegrationId,
    account_id: r.accountId ?? null,
    source_name: r.sourceName,
    status: r.status,
    started_at: r.startedAt,
    finished_at: r.finishedAt ?? null,
    imported_count: r.importedCount,
    skipped_count: r.skippedCount,
    error_count: r.errorCount,
    is_undoable: r.isUndoable,
    undone_at: r.undoneAt ?? null,
    error_message: r.errorMessage ?? null,
  };
}

function importRunFromRow(row: ImportRunRow): PortfolioImportRun {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerIntegrationId: row.provider_integration_id,
    accountId: row.account_id ?? undefined,
    sourceName: row.source_name,
    status: row.status as PortfolioImportRun['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    importedCount: row.imported_count,
    skippedCount: row.skipped_count,
    errorCount: row.error_count,
    isUndoable: row.is_undoable,
    undoneAt: row.undone_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function rawRowToRow(r: RawImportRow, userId: string): RawRowRow {
  return {
    id: r.id,
    user_id: userId,
    import_run_id: r.importRunId,
    provider_id: r.providerId,
    provider_integration_id: r.providerIntegrationId,
    row_number: r.rowNumber,
    row_payload: r.rowPayload,
    row_hash: r.rowHash,
    is_valid: r.isValid,
    error_code: r.errorCode ?? null,
    error_message: r.errorMessage ?? null,
    created_at: r.createdAt,
  };
}

function rawRowFromRow(row: RawRowRow): RawImportRow {
  return {
    id: row.id,
    importRunId: row.import_run_id,
    providerId: row.provider_id,
    providerIntegrationId: row.provider_integration_id,
    rowNumber: row.row_number,
    rowPayload: row.row_payload,
    rowHash: row.row_hash,
    isValid: row.is_valid,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
  };
}

function tradeToRow(t: TradeTransaction, userId: string): TradeRow {
  return {
    id: t.id,
    user_id: userId,
    provider_id: t.providerId,
    provider_integration_id: t.providerIntegrationId,
    import_run_id: t.importRunId ?? null,
    account_id: t.accountId,
    symbol: t.symbol,
    display_symbol: t.displaySymbol,
    external_trade_id: t.externalTradeId ?? null,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    fees: t.fees,
    currency: t.currency,
    trade_at: t.tradeAt,
    note: t.note ?? null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    deleted_at: t.deletedAt ?? null,
  };
}

function tradeFromRow(row: TradeRow): TradeTransaction {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerIntegrationId: row.provider_integration_id,
    importRunId: row.import_run_id ?? undefined,
    accountId: row.account_id,
    symbol: row.symbol,
    displaySymbol: row.display_symbol,
    externalTradeId: row.external_trade_id ?? undefined,
    side: row.side as TradeTransaction['side'],
    quantity: row.quantity,
    price: row.price,
    fees: row.fees,
    currency: row.currency,
    tradeAt: row.trade_at,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  };
}

function holdingRecordToRow(r: ProviderHoldingRecord, userId: string): HoldingRecordRow {
  return {
    id: r.id,
    user_id: userId,
    provider_id: r.providerId,
    provider_integration_id: r.providerIntegrationId,
    import_run_id: r.importRunId ?? null,
    account_id: r.accountId,
    security_id: r.securityId,
    security_name: r.securityName,
    action_type: r.actionType,
    quantity: r.quantity,
    cost_basis: r.costBasis,
    currency: r.currency,
    action_date: r.actionDate,
    current_price: r.currentPrice ?? null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    deleted_at: r.deletedAt ?? null,
  };
}

function holdingRecordFromRow(row: HoldingRecordRow): ProviderHoldingRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerIntegrationId: row.provider_integration_id,
    importRunId: row.import_run_id ?? undefined,
    accountId: row.account_id,
    securityId: row.security_id,
    securityName: row.security_name,
    actionType: row.action_type,
    quantity: row.quantity,
    costBasis: row.cost_basis,
    currency: row.currency,
    actionDate: row.action_date,
    currentPrice: row.current_price ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  };
}

function lotToRow(l: PositionLot, userId: string): LotRow {
  return {
    id: l.id,
    user_id: userId,
    provider_id: l.providerId,
    account_id: l.accountId,
    symbol: l.symbol,
    buy_trade_id: l.buyTradeId,
    original_qty: l.originalQty,
    open_qty: l.openQty,
    cost_per_unit: l.costPerUnit,
    fees_allocated: l.feesAllocated,
    opened_at: l.openedAt,
    updated_at: l.updatedAt,
    closed_at: l.closedAt ?? null,
  };
}

function lotFromRow(row: LotRow): PositionLot {
  return {
    id: row.id,
    providerId: row.provider_id,
    accountId: row.account_id,
    symbol: row.symbol,
    buyTradeId: row.buy_trade_id,
    originalQty: row.original_qty,
    openQty: row.open_qty,
    costPerUnit: row.cost_per_unit,
    feesAllocated: row.fees_allocated,
    openedAt: row.opened_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? undefined,
  };
}

function tickerMappingToRow(m: TickerMapping, userId: string): TickerMappingRow {
  return {
    user_id: userId,
    security_id: m.securityId,
    security_name: m.securityName,
    ticker: m.ticker,
    exchange: m.exchange ?? null,
    resolved_at: m.resolvedAt,
    resolved_by: m.resolvedBy,
  };
}

function tickerMappingFromRow(row: TickerMappingRow): TickerMapping {
  return {
    securityId: row.security_id,
    securityName: row.security_name,
    ticker: row.ticker,
    exchange: row.exchange ?? undefined,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by as TickerMapping['resolvedBy'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

export class SupabasePortfolioRepository implements PortfolioRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async getUserId(): Promise<string> {
    const { data: { session } } = await this.client.auth.getSession();
    if (!session) throw new Error('SupabasePortfolioRepository: no active session');
    return session.user.id;
  }

  // ── Providers ──────────────────────────────────────────────────────────────

  async upsertProvider(provider: Provider): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('providers')
      .upsert(providerToRow(provider, userId), { onConflict: 'id,user_id' });
    if (error) throw new Error(`[SupabasePortfolioRepository] providers.upsertProvider: ${error.message}`);
  }

  async getProviders(): Promise<Provider[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('providers')
      .select('*')
      .eq('user_id', userId);
    if (error) throw new Error(`[SupabasePortfolioRepository] providers.getProviders: ${error.message}`);
    return (data ?? []).map(providerFromRow);
  }

  // ── Accounts ───────────────────────────────────────────────────────────────

  async upsertAccount(account: Account): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('accounts')
      .upsert(accountToRow(account, userId), { onConflict: 'user_id,provider_id,id' });
    if (error) throw new Error(`[SupabasePortfolioRepository] accounts.upsertAccount: ${error.message}`);
  }

  async getAccount(providerId: string, accountId: string): Promise<Account | null> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw new Error(`[SupabasePortfolioRepository] accounts.getAccount: ${error.message}`);
    return data ? accountFromRow(data) : null;
  }

  async listAccountsByProvider(providerId: string): Promise<Account[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId);
    if (error) throw new Error(`[SupabasePortfolioRepository] accounts.listAccountsByProvider: ${error.message}`);
    return (data ?? []).map(accountFromRow);
  }

  async deleteAccount(providerId: string, accountId: string): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('accounts')
      .delete()
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .eq('id', accountId);
    if (error) throw new Error(`[SupabasePortfolioRepository] accounts.deleteAccount: ${error.message}`);
  }

  // ── ProviderIntegrations ───────────────────────────────────────────────────

  async upsertIntegration(integration: ProviderIntegration): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('provider_integrations')
      .upsert(integrationToRow(integration, userId), { onConflict: 'id,user_id' });
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_integrations.upsertIntegration: ${error.message}`);
  }

  async getIntegrationById(integrationId: string): Promise<ProviderIntegration | null> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('id', integrationId)
      .maybeSingle();
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_integrations.getIntegrationById: ${error.message}`);
    return data ? integrationFromRow(data) : null;
  }

  async listIntegrations(providerId: string): Promise<ProviderIntegration[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId);
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_integrations.listIntegrations: ${error.message}`);
    return (data ?? []).map(integrationFromRow);
  }

  // ── ProviderMappingProfiles ────────────────────────────────────────────────

  async upsertMappingProfile(profile: ProviderMappingProfile): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('provider_mapping_profiles')
      .upsert(profileToRow(profile, userId), { onConflict: 'id,user_id' });
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_mapping_profiles.upsertMappingProfile: ${error.message}`);
  }

  async getActiveMappingProfile(providerIntegrationId: string): Promise<ProviderMappingProfile | null> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_mapping_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_integration_id', providerIntegrationId)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_mapping_profiles.getActiveMappingProfile: ${error.message}`);
    return data ? profileFromRow(data) : null;
  }

  async listMappingProfiles(providerIntegrationId: string): Promise<ProviderMappingProfile[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_mapping_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_integration_id', providerIntegrationId)
      .order('version', { ascending: false });
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_mapping_profiles.listMappingProfiles: ${error.message}`);
    return (data ?? []).map(profileFromRow);
  }

  // ── ProviderAccountMappings ────────────────────────────────────────────────

  async upsertAccountMapping(mapping: ProviderAccountMapping): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('provider_account_mappings')
      .upsert(accountMappingToRow(mapping, userId), { onConflict: 'user_id,provider_id,provider_account_ref' });
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_account_mappings.upsertAccountMapping: ${error.message}`);
  }

  async getAccountMapping(providerId: string, providerAccountRef: string): Promise<ProviderAccountMapping | null> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_account_mappings')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .eq('provider_account_ref', providerAccountRef)
      .maybeSingle();
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_account_mappings.getAccountMapping: ${error.message}`);
    return data ? accountMappingFromRow(data) : null;
  }

  async listAccountMappings(providerId: string): Promise<ProviderAccountMapping[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_account_mappings')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId);
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_account_mappings.listAccountMappings: ${error.message}`);
    return (data ?? []).map(accountMappingFromRow);
  }

  // ── ProviderSymbolMappings ─────────────────────────────────────────────────

  async upsertSymbolMapping(mapping: ProviderSymbolMapping): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('provider_symbol_mappings')
      .upsert(symbolMappingToRow(mapping, userId), { onConflict: 'user_id,provider_id,provider_symbol' });
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_symbol_mappings.upsertSymbolMapping: ${error.message}`);
  }

  async getSymbolMapping(providerId: string, providerSymbol: string): Promise<ProviderSymbolMapping | null> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_symbol_mappings')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .eq('provider_symbol', providerSymbol)
      .maybeSingle();
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_symbol_mappings.getSymbolMapping: ${error.message}`);
    return data ? symbolMappingFromRow(data) : null;
  }

  // ── ImportRuns ─────────────────────────────────────────────────────────────

  async addImportRun(run: PortfolioImportRun): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('portfolio_import_runs')
      .insert(importRunToRow(run, userId));
    if (error) throw new Error(`[SupabasePortfolioRepository] portfolio_import_runs.addImportRun: ${error.message}`);
  }

  async updateImportRun(run: PortfolioImportRun): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('portfolio_import_runs')
      .upsert(importRunToRow(run, userId), { onConflict: 'id,user_id' });
    if (error) throw new Error(`[SupabasePortfolioRepository] portfolio_import_runs.updateImportRun: ${error.message}`);
  }

  async updateImportRunAccountId(oldAccountId: string, newAccountId: string, providerId: string): Promise<number> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('portfolio_import_runs')
      .update({ account_id: newAccountId })
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .eq('account_id', oldAccountId)
      .select();
    if (error) throw new Error(`[SupabasePortfolioRepository] portfolio_import_runs.updateImportRunAccountId: ${error.message}`);
    return data?.length ?? 0;
  }

  async listImportRuns(): Promise<PortfolioImportRun[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('portfolio_import_runs')
      .select('*')
      .eq('user_id', userId);
    if (error) throw new Error(`[SupabasePortfolioRepository] portfolio_import_runs.listImportRuns: ${error.message}`);
    return (data ?? []).map(importRunFromRow);
  }

  async listImportRunsByProvider(providerId: string): Promise<PortfolioImportRun[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('portfolio_import_runs')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId);
    if (error) throw new Error(`[SupabasePortfolioRepository] portfolio_import_runs.listImportRunsByProvider: ${error.message}`);
    return (data ?? []).map(importRunFromRow);
  }

  async getLastSuccessfulImportRun(providerIntegrationId: string): Promise<PortfolioImportRun | null> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('portfolio_import_runs')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_integration_id', providerIntegrationId)
      .eq('status', 'success')
      .is('undone_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`[SupabasePortfolioRepository] portfolio_import_runs.getLastSuccessfulImportRun: ${error.message}`);
    return data ? importRunFromRow(data) : null;
  }

  // ── RawImportRows ──────────────────────────────────────────────────────────

  async addRawRows(rows: RawImportRow[]): Promise<void> {
    if (rows.length === 0) return;
    const userId = await this.getUserId();
    const rowBatches = chunks(rows.map(r => rawRowToRow(r, userId)), BATCH_SIZE);
    for (const batch of rowBatches) {
      const { error } = await this.client.from('raw_import_rows').insert(batch);
      if (error) throw new Error(`[SupabasePortfolioRepository] raw_import_rows.addRawRows: ${error.message}`);
    }
  }

  async listRawRowsByImportRun(importRunId: string): Promise<RawImportRow[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('raw_import_rows')
      .select('*')
      .eq('user_id', userId)
      .eq('import_run_id', importRunId);
    if (error) throw new Error(`[SupabasePortfolioRepository] raw_import_rows.listRawRowsByImportRun: ${error.message}`);
    return (data ?? []).map(rawRowFromRow);
  }

  // ── TradeTransactions ──────────────────────────────────────────────────────

  async upsertTrades(trades: TradeTransaction[]): Promise<void> {
    if (trades.length === 0) return;
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('trade_transactions')
      .upsert(trades.map(t => tradeToRow(t, userId)), { onConflict: 'id,user_id' });
    if (error) throw new Error(`[SupabasePortfolioRepository] trade_transactions.upsertTrades: ${error.message}`);
  }

  async listTradesByProvider(providerId: string): Promise<TradeTransaction[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('trade_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .is('deleted_at', null);
    if (error) throw new Error(`[SupabasePortfolioRepository] trade_transactions.listTradesByProvider: ${error.message}`);
    return (data ?? []).map(tradeFromRow);
  }

  async listTradesByAccount(providerId: string, accountId: string): Promise<TradeTransaction[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('trade_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .eq('account_id', accountId)
      .is('deleted_at', null);
    if (error) throw new Error(`[SupabasePortfolioRepository] trade_transactions.listTradesByAccount: ${error.message}`);
    return (data ?? []).map(tradeFromRow);
  }

  async listTradesByIntegration(providerIntegrationId: string): Promise<TradeTransaction[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('trade_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_integration_id', providerIntegrationId)
      .is('deleted_at', null);
    if (error) throw new Error(`[SupabasePortfolioRepository] trade_transactions.listTradesByIntegration: ${error.message}`);
    return (data ?? []).map(tradeFromRow);
  }

  async listTradesByImportRun(importRunId: string): Promise<TradeTransaction[]> {
    const userId = await this.getUserId();
    // Note: does NOT filter deleted_at — all rows for a run (audit trail)
    const { data, error } = await this.client
      .from('trade_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('import_run_id', importRunId);
    if (error) throw new Error(`[SupabasePortfolioRepository] trade_transactions.listTradesByImportRun: ${error.message}`);
    return (data ?? []).map(tradeFromRow);
  }

  async listTradesByAccountSymbol(accountId: string, symbol: string): Promise<TradeTransaction[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('trade_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .eq('symbol', symbol)
      .is('deleted_at', null)
      .order('trade_at', { ascending: true });
    if (error) throw new Error(`[SupabasePortfolioRepository] trade_transactions.listTradesByAccountSymbol: ${error.message}`);
    return (data ?? []).map(tradeFromRow);
  }

  // ── ProviderHoldingRecords ─────────────────────────────────────────────────

  async upsertHoldingRecords(records: ProviderHoldingRecord[]): Promise<void> {
    if (records.length === 0) return;
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('provider_holding_records')
      .upsert(records.map(r => holdingRecordToRow(r, userId)), { onConflict: 'id,user_id' });
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_holding_records.upsertHoldingRecords: ${error.message}`);
  }

  async listHoldingRecords(): Promise<ProviderHoldingRecord[]> {
    const userId = await this.getUserId();
    // Returns ALL records including soft-deleted (consistent with local impl)
    const { data, error } = await this.client
      .from('provider_holding_records')
      .select('*')
      .eq('user_id', userId);
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_holding_records.listHoldingRecords: ${error.message}`);
    return (data ?? []).map(holdingRecordFromRow);
  }

  async listHoldingRecordsByProvider(providerId: string): Promise<ProviderHoldingRecord[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_holding_records')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .is('deleted_at', null);
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_holding_records.listHoldingRecordsByProvider: ${error.message}`);
    return (data ?? []).map(holdingRecordFromRow);
  }

  async listHoldingRecordsByAccount(providerId: string, accountId: string): Promise<ProviderHoldingRecord[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('provider_holding_records')
      .select('*')
      .eq('user_id', userId)
      .eq('provider_id', providerId)
      .eq('account_id', accountId)
      .is('deleted_at', null);
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_holding_records.listHoldingRecordsByAccount: ${error.message}`);
    return (data ?? []).map(holdingRecordFromRow);
  }

  async listHoldingRecordsByImportRun(importRunId: string): Promise<ProviderHoldingRecord[]> {
    const userId = await this.getUserId();
    // Note: does NOT filter deleted_at — all rows for the run (audit trail)
    const { data, error } = await this.client
      .from('provider_holding_records')
      .select('*')
      .eq('user_id', userId)
      .eq('import_run_id', importRunId);
    if (error) throw new Error(`[SupabasePortfolioRepository] provider_holding_records.listHoldingRecordsByImportRun: ${error.message}`);
    return (data ?? []).map(holdingRecordFromRow);
  }

  async deleteImportRunContribution(runId: string): Promise<void> {
    // ⚠️ NON-ATOMIC — two sequential updates. See SUPABASE_METHOD_CONTRACTS.md for rationale.
    const userId = await this.getUserId();
    const now = new Date().toISOString();

    // Step 1: soft-delete holding records
    const { error: holdingError } = await this.client
      .from('provider_holding_records')
      .update({ deleted_at: now, updated_at: now })
      .eq('user_id', userId)
      .eq('import_run_id', runId);
    if (holdingError) throw new Error(`[SupabasePortfolioRepository] provider_holding_records.deleteImportRunContribution step1: ${holdingError.message}`);

    // Step 2: mark run as undone
    const { error: runError } = await this.client
      .from('portfolio_import_runs')
      .update({ is_undoable: false, undone_at: now })
      .eq('user_id', userId)
      .eq('id', runId);
    if (runError) throw new Error(`[SupabasePortfolioRepository] portfolio_import_runs.deleteImportRunContribution step2: ${runError.message}`);
  }

  async getProvenanceForSecurity(securityId: string): Promise<readonly ImportRunProvenance[]> {
    const userId = await this.getUserId();

    // Query 1: active holding records for this security
    const { data: holdingData, error: holdingError } = await this.client
      .from('provider_holding_records')
      .select('import_run_id')
      .eq('user_id', userId)
      .eq('security_id', securityId)
      .is('deleted_at', null)
      .not('import_run_id', 'is', null);
    if (holdingError) throw new Error(`[SupabasePortfolioRepository] provider_holding_records.getProvenanceForSecurity q1: ${holdingError.message}`);

    const runIds = [...new Set((holdingData ?? []).map((r: { import_run_id: string }) => r.import_run_id))];
    if (runIds.length === 0) return [];

    // Query 2: run metadata
    const { data: runData, error: runError } = await this.client
      .from('portfolio_import_runs')
      .select('id, started_at, account_id')
      .eq('user_id', userId)
      .in('id', runIds);
    if (runError) throw new Error(`[SupabasePortfolioRepository] portfolio_import_runs.getProvenanceForSecurity q2: ${runError.message}`);

    const runById = new Map<string, { started_at: string; account_id: string | null }>();
    for (const run of runData ?? []) {
      runById.set(run.id, run);
    }

    // JS join: count lots per run
    const lotCountByRunId = new Map<string, number>();
    for (const r of holdingData ?? []) {
      const runId = r.import_run_id as string;
      lotCountByRunId.set(runId, (lotCountByRunId.get(runId) ?? 0) + 1);
    }

    const provenances: ImportRunProvenance[] = [];
    for (const [runId, lotCount] of lotCountByRunId.entries()) {
      const run = runById.get(runId);
      if (!run) continue;
      provenances.push({
        runId,
        importDate: run.started_at,
        accountId: run.account_id ?? 'default',
        lotCount,
      });
    }

    provenances.sort((a, b) => b.importDate.localeCompare(a.importDate));
    return provenances;
  }

  // ── PositionLots ───────────────────────────────────────────────────────────

  async replaceLots(lots: PositionLot[]): Promise<void> {
    // ⚠️ NON-ATOMIC — delete then insert. See SUPABASE_METHOD_CONTRACTS.md for rationale.
    const userId = await this.getUserId();

    // Step 1: delete all lots for this user
    const { error: deleteError } = await this.client
      .from('position_lots')
      .delete()
      .eq('user_id', userId);
    if (deleteError) throw new Error(`[SupabasePortfolioRepository] position_lots.replaceLots delete: ${deleteError.message}`);

    // Step 2: insert new lots in batches
    if (lots.length === 0) return;
    const lotBatches = chunks(lots.map(l => lotToRow(l, userId)), BATCH_SIZE);
    for (const batch of lotBatches) {
      const { error } = await this.client.from('position_lots').insert(batch);
      if (error) throw new Error(`[SupabasePortfolioRepository] position_lots.replaceLots insert: ${error.message}`);
    }
  }

  async listLotsByAccountSymbol(accountId: string, symbol: string): Promise<PositionLot[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('position_lots')
      .select('*')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .eq('symbol', symbol);
    if (error) throw new Error(`[SupabasePortfolioRepository] position_lots.listLotsByAccountSymbol: ${error.message}`);
    return (data ?? []).map(lotFromRow);
  }

  // ── TickerMappings ─────────────────────────────────────────────────────────

  async upsertTickerMapping(mapping: TickerMapping): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('ticker_mappings')
      .upsert(tickerMappingToRow(mapping, userId), { onConflict: 'user_id,security_id' });
    if (error) throw new Error(`[SupabasePortfolioRepository] ticker_mappings.upsertTickerMapping: ${error.message}`);
  }

  async getTickerMapping(securityId: string): Promise<TickerMapping | null> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('ticker_mappings')
      .select('*')
      .eq('user_id', userId)
      .eq('security_id', securityId)
      .maybeSingle();
    if (error) throw new Error(`[SupabasePortfolioRepository] ticker_mappings.getTickerMapping: ${error.message}`);
    return data ? tickerMappingFromRow(data) : null;
  }

  async listTickerMappings(): Promise<TickerMapping[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.client
      .from('ticker_mappings')
      .select('*')
      .eq('user_id', userId);
    if (error) throw new Error(`[SupabasePortfolioRepository] ticker_mappings.listTickerMappings: ${error.message}`);
    return (data ?? []).map(tickerMappingFromRow);
  }

  async deleteTickerMapping(securityId: string): Promise<void> {
    const userId = await this.getUserId();
    const { error } = await this.client
      .from('ticker_mappings')
      .delete()
      .eq('user_id', userId)
      .eq('security_id', securityId);
    if (error) throw new Error(`[SupabasePortfolioRepository] ticker_mappings.deleteTickerMapping: ${error.message}`);
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  async resetAllData(): Promise<void> {
    // ⚠️ NON-ATOMIC — six sequential deletes in reverse FK order. Dev/debug only.
    const userId = await this.getUserId();

    const tables = [
      'ticker_mappings',
      'position_lots',
      'provider_holding_records',
      'trade_transactions',
      'raw_import_rows',
      'portfolio_import_runs',
    ] as const;

    for (const table of tables) {
      const { error } = await this.client.from(table).delete().eq('user_id', userId);
      if (error) throw new Error(`[SupabasePortfolioRepository] ${table}.resetAllData: ${error.message}`);
    }
  }
}
