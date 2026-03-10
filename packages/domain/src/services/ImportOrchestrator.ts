import type { PortfolioRepository } from '../repositories';
import { runCsvPatternFitCheck } from './PatternFitCheck';
import type {
  PortfolioImportRun,
  ProviderHoldingRecord,
  ProviderIntegration,
  ProviderMappingProfile,
  RawImportRow,
  TradeTransaction,
} from '../types';

export interface ImportPreviewRow {
  rowNumber: number;
  rowPayload: Record<string, string>;
  normalized?: Record<string, unknown>;
  isValid: boolean;
  isDuplicate: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface ImportPreviewResult {
  providerId: string;
  providerIntegrationId: string;
  validRows: ImportPreviewRow[];
  invalidRows: ImportPreviewRow[];
  duplicateRows: ImportPreviewRow[];
}

export interface ImportCommitResult {
  importRun: PortfolioImportRun;
  importedTrades: number;
  skippedRows: number;
  errorRows: number;
}

interface ImportContext {
  providerId: string;
  providerIntegrationId: string;
  integration: ProviderIntegration;
  profile: ProviderMappingProfile;
}

interface DomainImportHandler {
  readonly dataDomain: ProviderIntegration['dataDomain'];
  preview(context: ImportContext, csvText: string): Promise<ImportPreviewResult>;
  commit(context: ImportContext, preview: ImportPreviewResult, runId: string): Promise<void>;
  undo(context: ImportContext, runId: string): Promise<void>;
}

export class ImportOrchestrator {
  private readonly handlers: Map<ProviderIntegration['dataDomain'], DomainImportHandler>;

  constructor(
    private readonly repository: PortfolioRepository,
    handlers: DomainImportHandler[],
  ) {
    this.handlers = new Map(handlers.map((handler) => [handler.dataDomain, handler]));
  }

  async previewImport(params: {
    providerId: string;
    providerIntegrationId: string;
    csvText: string;
  }): Promise<ImportPreviewResult> {
    const context = await this.prepareContext(params.providerId, params.providerIntegrationId);
    assertCsvPatternFit(context.profile, params.csvText);
    const handler = this.getHandler(context.integration.dataDomain);
    return handler.preview(context, params.csvText);
  }

  async commitImport(params: {
    providerId: string;
    providerIntegrationId: string;
    sourceName: string;
    csvText: string;
  }): Promise<ImportCommitResult> {
    const context = await this.prepareContext(params.providerId, params.providerIntegrationId);
    assertCsvPatternFit(context.profile, params.csvText);
    const handler = this.getHandler(context.integration.dataDomain);

    const startedAt = nowIso();
    const runId = makeId('run');

    const run: PortfolioImportRun = {
      id: runId,
      providerId: params.providerId,
      providerIntegrationId: params.providerIntegrationId,
      sourceName: params.sourceName,
      status: 'running',
      startedAt,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      isUndoable: false,
    };

    await this.repository.addImportRun(run);

    try {
      const preview = await handler.preview(context, params.csvText);

      const rawRows: RawImportRow[] = [
        ...preview.validRows,
        ...preview.invalidRows,
        ...preview.duplicateRows,
      ].map((row) => ({
        id: makeId('raw'),
        importRunId: runId,
        providerId: params.providerId,
        providerIntegrationId: params.providerIntegrationId,
        rowNumber: row.rowNumber,
        rowPayload: JSON.stringify(row.rowPayload),
        rowHash: hashRow(row.rowPayload),
        isValid: row.isValid && !row.isDuplicate,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        createdAt: nowIso(),
      }));

      await this.repository.addRawRows(rawRows);
      await handler.commit(context, preview, runId);

      const completed: PortfolioImportRun = {
        ...run,
        status: 'success',
        finishedAt: nowIso(),
        importedCount: preview.validRows.length,
        skippedCount: preview.duplicateRows.length,
        errorCount: preview.invalidRows.length,
        isUndoable: true,
      };

      await this.repository.updateImportRun(completed);

      return {
        importRun: completed,
        importedTrades: preview.validRows.length,
        skippedRows: preview.duplicateRows.length,
        errorRows: preview.invalidRows.length,
      };
    } catch (error) {
      const failed: PortfolioImportRun = {
        ...run,
        status: 'failed',
        finishedAt: nowIso(),
        errorMessage: error instanceof Error ? error.message : 'Unknown import failure',
      };
      await this.repository.updateImportRun(failed);
      throw error;
    }
  }

  async undoLastImport(providerIntegrationId: string): Promise<PortfolioImportRun | null> {
    const last = await this.repository.getLastSuccessfulImportRun(providerIntegrationId);
    if (!last || !last.isUndoable) return null;

    const context = await this.prepareContext(last.providerId, last.providerIntegrationId);
    const handler = this.getHandler(context.integration.dataDomain);

    await handler.undo(context, last.id);

    const undone: PortfolioImportRun = {
      ...last,
      isUndoable: false,
      undoneAt: nowIso(),
    };

    await this.repository.updateImportRun(undone);
    return undone;
  }

  private getHandler(dataDomain: ProviderIntegration['dataDomain']): DomainImportHandler {
    const handler = this.handlers.get(dataDomain);
    if (!handler) {
      throw new Error(`Unsupported data domain for preview: ${dataDomain}`);
    }
    return handler;
  }

  private async prepareContext(providerId: string, providerIntegrationId: string): Promise<ImportContext> {
    const integration = await this.repository.getIntegrationById(providerIntegrationId);
    if (!integration) {
      throw new Error(`Unknown provider integration: ${providerIntegrationId}`);
    }

    if (integration.providerId !== providerId) {
      throw new Error('Provider and integration mismatch');
    }

    const profile = await this.repository.getActiveMappingProfile(providerIntegrationId);
    if (!profile) {
      throw new Error(`No active mapping profile for integration: ${providerIntegrationId}`);
    }

    validateRequiredMappings(profile);

    return {
      providerId,
      providerIntegrationId,
      integration,
      profile,
    };
  }
}

export class TradesImportHandler implements DomainImportHandler {
  readonly dataDomain = 'trades' as const;

  constructor(private readonly repository: PortfolioRepository) {}

  async preview(context: ImportContext, csvText: string): Promise<ImportPreviewResult> {
    const parsedRows = parseCsv(csvText);
    if (parsedRows.length === 0) {
      return {
        providerId: context.providerId,
        providerIntegrationId: context.providerIntegrationId,
        validRows: [],
        invalidRows: [],
        duplicateRows: [],
      };
    }

    const existingTrades = await this.repository.listTradesByProvider(context.providerId);
    const accountMappings = await this.repository.listAccountMappings(context.providerId);
    const accountMappingByRef = new Map(accountMappings.map((mapping) => [mapping.providerAccountRef, mapping.accountId]));
    const knownAccountIds = new Set(existingTrades.map((trade) => trade.accountId));
    const requireAccountMapping = Boolean(context.profile.parsingRules?.requireAccountMapping);

    const previewRows = parsedRows.map((row, idx) =>
      toPreviewRow({
        row,
        rowNumber: idx + 1,
        providerId: context.providerId,
        providerIntegrationId: context.providerIntegrationId,
        profile: context.profile,
        existingTrades,
        accountMappingByRef,
        knownAccountIds,
        requireAccountMapping,
      }),
    );

    return {
      providerId: context.providerId,
      providerIntegrationId: context.providerIntegrationId,
      validRows: previewRows.filter((row) => row.isValid && !row.isDuplicate),
      invalidRows: previewRows.filter((row) => !row.isValid),
      duplicateRows: previewRows.filter((row) => row.isValid && row.isDuplicate),
    };
  }

  async commit(_context: ImportContext, preview: ImportPreviewResult, runId: string): Promise<void> {
    const trades = preview.validRows.map((row) => ({
      ...(row.normalized as TradeTransaction),
      importRunId: runId,
    }));
    await this.repository.upsertTrades(trades);
  }

  async undo(_context: ImportContext, runId: string): Promise<void> {
    const trades = await this.repository.listTradesByImportRun(runId);
    const deletedAt = nowIso();
    const softDeleted = trades.map((trade) => ({ ...trade, deletedAt, updatedAt: deletedAt }));
    await this.repository.upsertTrades(softDeleted);
  }
}

export class PsagotHoldingsImportHandler implements DomainImportHandler {
  readonly dataDomain = 'holdings' as const;

  constructor(private readonly repository: PortfolioRepository) {}

  async preview(context: ImportContext, csvText: string): Promise<ImportPreviewResult> {
    const parsedRows = parseCsv(csvText);
    if (parsedRows.length === 0) {
      return {
        providerId: context.providerId,
        providerIntegrationId: context.providerIntegrationId,
        validRows: [],
        invalidRows: [],
        duplicateRows: [],
      };
    }

    const existing = await this.repository.listHoldingRecordsByProvider(context.providerId);
    const previewRows = parsedRows.map((row, idx) =>
      toHoldingPreviewRow({
        row,
        rowNumber: idx + 1,
        providerId: context.providerId,
        providerIntegrationId: context.providerIntegrationId,
        profile: context.profile,
        existing,
      }),
    );

    return {
      providerId: context.providerId,
      providerIntegrationId: context.providerIntegrationId,
      validRows: previewRows.filter((row) => row.isValid && !row.isDuplicate),
      invalidRows: previewRows.filter((row) => !row.isValid),
      duplicateRows: previewRows.filter((row) => row.isValid && row.isDuplicate),
    };
  }

  async commit(_context: ImportContext, preview: ImportPreviewResult, runId: string): Promise<void> {
    const records = preview.validRows.map((row) => ({
      ...(row.normalized as ProviderHoldingRecord),
      importRunId: runId,
    }));
    await this.repository.upsertHoldingRecords(records);
  }

  async undo(_context: ImportContext, runId: string): Promise<void> {
    const records = await this.repository.listHoldingRecordsByImportRun(runId);
    const deletedAt = nowIso();
    const softDeleted = records.map((record) => ({ ...record, deletedAt, updatedAt: deletedAt }));
    await this.repository.upsertHoldingRecords(softDeleted);
  }
}

function toPreviewRow(params: {
  row: Record<string, string>;
  rowNumber: number;
  providerId: string;
  providerIntegrationId: string;
  profile: ProviderMappingProfile;
  existingTrades: TradeTransaction[];
  accountMappingByRef: Map<string, string>;
  knownAccountIds: Set<string>;
  requireAccountMapping: boolean;
}): ImportPreviewRow {
  const normalizedOrError = normalizeTradeRow(params.row, params.profile);
  if ('errorCode' in normalizedOrError) {
    return {
      rowNumber: params.rowNumber,
      rowPayload: params.row,
      isValid: false,
      isDuplicate: false,
      errorCode: normalizedOrError.errorCode,
      errorMessage: normalizedOrError.errorMessage,
    };
  }

  const normalized: TradeTransaction = {
    ...normalizedOrError.trade,
    id: makeId('trade'),
    providerId: params.providerId,
    providerIntegrationId: params.providerIntegrationId,
    importRunId: undefined,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const resolvedAccountId = resolveAccountId(
    normalized.accountId,
    params.accountMappingByRef,
    params.knownAccountIds,
    params.requireAccountMapping,
  );
  if (!resolvedAccountId) {
    return {
      rowNumber: params.rowNumber,
      rowPayload: params.row,
      isValid: false,
      isDuplicate: false,
      errorCode: 'ACCOUNT_ID_UNRESOLVED',
      errorMessage: 'Account is not mapped/known. Add account mapping or cancel import.',
    };
  }
  normalized.accountId = resolvedAccountId;

  const duplicate = isDuplicateTrade(normalized, params.existingTrades);

  return {
    rowNumber: params.rowNumber,
    rowPayload: params.row,
    normalized,
    isValid: true,
    isDuplicate: duplicate,
    errorCode: duplicate ? 'DUPLICATE_TRADE' : undefined,
    errorMessage: duplicate ? 'Row appears to be an existing trade' : undefined,
  };
}

function toHoldingPreviewRow(params: {
  row: Record<string, string>;
  rowNumber: number;
  providerId: string;
  providerIntegrationId: string;
  profile: ProviderMappingProfile;
  existing: ProviderHoldingRecord[];
}): ImportPreviewRow {
  const normalizedOrError = normalizeHoldingRow(params.row, params.profile);
  if ('errorCode' in normalizedOrError) {
    return {
      rowNumber: params.rowNumber,
      rowPayload: params.row,
      isValid: false,
      isDuplicate: false,
      errorCode: normalizedOrError.errorCode,
      errorMessage: normalizedOrError.errorMessage,
    };
  }

  const normalized: ProviderHoldingRecord = {
    ...normalizedOrError.record,
    id: makeId('holding_row'),
    providerId: params.providerId,
    providerIntegrationId: params.providerIntegrationId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const duplicate = isDuplicateHolding(normalized, params.existing);

  return {
    rowNumber: params.rowNumber,
    rowPayload: params.row,
    normalized,
    isValid: true,
    isDuplicate: duplicate,
    errorCode: duplicate ? 'DUPLICATE_HOLDING_ROW' : undefined,
    errorMessage: duplicate ? 'Row appears to be an existing holding record' : undefined,
  };
}

function normalizeTradeRow(
  row: Record<string, string>,
  profile: ProviderMappingProfile,
):
  | { trade: Omit<TradeTransaction, 'id' | 'providerId' | 'providerIntegrationId' | 'importRunId' | 'createdAt' | 'updatedAt'> }
  | { errorCode: string; errorMessage: string } {
  const read = (field: string): string => {
    const sourceColumn = profile.fieldMappings[field];
    const raw = sourceColumn ? row[sourceColumn] : '';
    const mapped = profile.valueMappings?.[field]?.[raw] ?? raw;
    return (mapped ?? '').trim();
  };

  const accountId = read('accountId');
  const symbol = read('symbol');
  const displaySymbol = read('displaySymbol') || symbol;
  const sideRaw = read('side').toLowerCase();
  const quantityRaw = read('quantity');
  const priceRaw = read('price');
  const feesRaw = read('fees') || '0';
  const currency = read('currency') || 'ILS';
  const tradeAt = read('tradeAt');
  const externalTradeId = read('externalTradeId') || undefined;
  const note = read('note') || undefined;

  if (!accountId || !symbol || !sideRaw || !quantityRaw || !priceRaw || !tradeAt) {
    return {
      errorCode: 'MISSING_REQUIRED_FIELDS',
      errorMessage: 'Missing one of required fields: accountId, symbol, side, quantity, price, tradeAt',
    };
  }

  if (sideRaw !== 'buy' && sideRaw !== 'sell') {
    return { errorCode: 'INVALID_SIDE', errorMessage: `Invalid side: ${sideRaw}` };
  }
  const side: 'buy' | 'sell' = sideRaw;

  const quantity = Number(quantityRaw);
  const price = Number(priceRaw);
  const fees = Number(feesRaw);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { errorCode: 'INVALID_QUANTITY', errorMessage: `Invalid quantity: ${quantityRaw}` };
  }

  if (!Number.isFinite(price) || price <= 0) {
    return { errorCode: 'INVALID_PRICE', errorMessage: `Invalid price: ${priceRaw}` };
  }

  if (!Number.isFinite(fees) || fees < 0) {
    return { errorCode: 'INVALID_FEES', errorMessage: `Invalid fees: ${feesRaw}` };
  }

  return {
    trade: {
      accountId,
      symbol,
      displaySymbol,
      side,
      quantity,
      price,
      fees,
      currency,
      tradeAt,
      externalTradeId,
      note,
    },
  };
}

function normalizeHoldingRow(
  row: Record<string, string>,
  profile: ProviderMappingProfile,
):
  | { record: Omit<ProviderHoldingRecord, 'id' | 'providerId' | 'providerIntegrationId' | 'importRunId' | 'createdAt' | 'updatedAt'> }
  | { errorCode: string; errorMessage: string } {
  const read = (field: string): string => {
    const sourceColumn = profile.fieldMappings[field];
    const raw = sourceColumn ? row[sourceColumn] : '';
    const mapped = profile.valueMappings?.[field]?.[raw] ?? raw;
    return decodeHtmlEntities((mapped ?? '').trim());
  };

  const securityId = read('securityId');
  const securityName = read('securityName');
  const actionType = read('actionType');
  const quantityRaw = read('quantity');
  const costBasisRaw = read('costBasis');
  const currency = read('currency');
  const actionDateRaw = read('actionDate');
  const currentPriceRaw = read('currentPrice');

  if (!securityId || !securityName || !actionType || !quantityRaw || !costBasisRaw || !currency || !actionDateRaw) {
    return {
      errorCode: 'MISSING_REQUIRED_FIELDS',
      errorMessage: 'Missing one of required fields: securityId, securityName, actionType, quantity, costBasis, currency, actionDate',
    };
  }

  const quantity = parseLocalizedNumber(quantityRaw);
  const costBasis = parseLocalizedNumber(costBasisRaw);
  const currentPrice = currentPriceRaw ? parseLocalizedNumber(currentPriceRaw) : undefined;
  const actionDate = parseDayMonthYearDate(actionDateRaw);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { errorCode: 'INVALID_QUANTITY', errorMessage: `Invalid quantity: ${quantityRaw}` };
  }
  if (!Number.isFinite(costBasis) || costBasis <= 0) {
    return { errorCode: 'INVALID_COST_BASIS', errorMessage: `Invalid cost basis: ${costBasisRaw}` };
  }
  if (!actionDate) {
    return { errorCode: 'INVALID_ACTION_DATE', errorMessage: `Invalid action date: ${actionDateRaw}` };
  }
  if (typeof currentPrice !== 'undefined' && (!Number.isFinite(currentPrice) || currentPrice <= 0)) {
    return { errorCode: 'INVALID_CURRENT_PRICE', errorMessage: `Invalid current price: ${currentPriceRaw}` };
  }

  return {
    record: {
      securityId,
      securityName,
      actionType,
      quantity,
      costBasis,
      currency,
      actionDate,
      currentPrice,
    },
  };
}

function isDuplicateTrade(candidate: TradeTransaction, existing: TradeTransaction[]): boolean {
  if (candidate.externalTradeId) {
    const byExternal = existing.some(
      (item) => item.externalTradeId && item.externalTradeId === candidate.externalTradeId,
    );
    if (byExternal) return true;
  }

  const candidateKey = compositeKey(candidate);
  return existing.some((item) => compositeKey(item) === candidateKey);
}

function compositeKey(tx: TradeTransaction): string {
  return [tx.accountId, tx.symbol, tx.side, tx.quantity, tx.price, tx.tradeAt].join('|');
}

function isDuplicateHolding(candidate: ProviderHoldingRecord, existing: ProviderHoldingRecord[]): boolean {
  const key = holdingCompositeKey(candidate);
  return existing.some((item) => holdingCompositeKey(item) === key);
}

function holdingCompositeKey(row: ProviderHoldingRecord): string {
  return [row.securityId, row.actionType, row.quantity, row.actionDate, row.costBasis].join('|');
}

function parseCsv(csvText: string): Record<string, string>[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = cols[j] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"' && (inQuotes || current.length === 0)) {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((value) => value.trim());
}

function parseDayMonthYearDate(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalizedNumber(value: string): number {
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashRow(row: Record<string, string>): string {
  const input = Object.keys(row)
    .sort()
    .map((key) => `${key}:${row[key]}`)
    .join('|');

  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

function validateRequiredMappings(profile: ProviderMappingProfile): void {
  const required = profile.requiredCanonicalFields ?? [];
  const missing = required.filter((field) => !profile.fieldMappings[field]);
  if (missing.length > 0) {
    throw new Error(`Mapping profile is missing required field mappings: ${missing.join(', ')}`);
  }
}

function assertCsvPatternFit(profile: ProviderMappingProfile, csvText: string): void {
  const fitResult = runCsvPatternFitCheck(profile, csvText);
  if (fitResult.decision === 'fail') {
    throw new Error(`Pattern fit failed: ${fitResult.reasons.join('; ')}`);
  }
}

function resolveAccountId(
  rawAccountId: string,
  accountMappingByRef: Map<string, string>,
  knownAccountIds: Set<string>,
  requireAccountMapping: boolean,
): string | null {
  const mapped = accountMappingByRef.get(rawAccountId);
  if (mapped) return mapped;

  if (knownAccountIds.has(rawAccountId)) return rawAccountId;

  if (requireAccountMapping) return null;

  return rawAccountId;
}
