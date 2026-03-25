import type { PortfolioRepository } from '../repositories';
import type {
  PsagotBalance,
  PortfolioImportRun,
  ProviderHoldingRecord,
  PsagotApiError,
  RawImportRow,
} from '../types';
import { makeId, nowIso } from '../utils/idUtils';
import type { AccountService } from './AccountService';
import type { PsagotApiImportHandler } from './PsagotApiImportHandler';

interface SyncAccountParams {
  readonly balances: readonly PsagotBalance[];
  readonly providerId: string;
  readonly providerIntegrationId: string;
  readonly accountId: string;
  readonly agorotConversion: boolean;
}

interface SyncAllAccountsParams {
  readonly accountBalances: ReadonlyArray<{
    readonly accountId: string;
    readonly balances: readonly PsagotBalance[];
  }>;
  readonly providerId: string;
  readonly providerIntegrationId: string;
  readonly agorotConversion: boolean;
}

export interface ApiSyncResult {
  readonly accountId: string;
  readonly importRun: PortfolioImportRun;
  readonly newRecords: number;
  readonly updatedRecords: number;
  readonly removedRecords: number;
}

export interface ApiSyncSummary {
  readonly accountsSynced: number;
  readonly totalNewRecords: number;
  readonly totalUpdatedRecords: number;
  readonly totalRemovedRecords: number;
  readonly importRuns: PortfolioImportRun[];
  readonly errors: ReadonlyArray<{ accountId: string; error: PsagotApiError }>;
}

export class PsagotApiSyncService {
  constructor(
    private readonly repository: PortfolioRepository,
    private readonly accountService: AccountService,
    private readonly handler: PsagotApiImportHandler,
  ) {}

  async syncAccount(params: SyncAccountParams): Promise<ApiSyncResult> {
    const startedAt = nowIso();
    const runId = makeId('api_run');

    // Get existing API records for this account + integration
    const allExisting = await this.repository.listHoldingRecordsByAccount(
      params.providerId,
      params.accountId,
    );
    const existingApiRecords = allExisting.filter(
      (r) => r.providerIntegrationId === params.providerIntegrationId,
    );

    // Map balances to new records
    const newRecords = this.handler.mapBalancesToHoldingRecords({
      balances: params.balances,
      providerId: params.providerId,
      providerIntegrationId: params.providerIntegrationId,
      accountId: params.accountId,
      importRunId: runId,
      existingRecords: allExisting,
      agorotConversion: params.agorotConversion,
    });

    // Reconcile
    const existingBySecurityId = new Map<string, ProviderHoldingRecord>();
    for (const r of existingApiRecords) {
      existingBySecurityId.set(r.securityId, r);
    }

    const newSecurityIds = new Set(newRecords.map((r) => r.securityId));

    let newCount = 0;
    let updatedCount = 0;
    let removedCount = 0;

    const recordsToUpsert: ProviderHoldingRecord[] = [];

    for (const record of newRecords) {
      const existing = existingBySecurityId.get(record.securityId);
      if (!existing) {
        // New position
        recordsToUpsert.push(record);
        newCount++;
      } else {
        // Existing — update with new data, preserve original id and createdAt
        recordsToUpsert.push({
          ...record,
          id: existing.id,
          createdAt: existing.createdAt,
        });
        updatedCount++;
      }
    }

    // Soft-delete removed positions
    const now = nowIso();
    for (const existing of existingApiRecords) {
      if (!newSecurityIds.has(existing.securityId)) {
        recordsToUpsert.push({
          ...existing,
          deletedAt: now,
          updatedAt: now,
        });
        removedCount++;
      }
    }

    // Create import run first (in_progress), then upsert records, then mark success
    const importRun: PortfolioImportRun = {
      id: runId,
      providerId: params.providerId,
      providerIntegrationId: params.providerIntegrationId,
      accountId: params.accountId,
      sourceName: 'Psagot API Sync',
      status: 'running',
      startedAt,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      isUndoable: false,
    };

    await this.repository.addImportRun(importRun);

    // Build and store raw rows for ALL input balances (including invalid ones) before
    // upserting holding records — ensures audit trail even if upsert fails.
    const rawRows = buildRawRowsFromBalances({
      balances: params.balances,
      importRunId: runId,
      providerId: params.providerId,
      providerIntegrationId: params.providerIntegrationId,
    });
    if (rawRows.length > 0) {
      await this.repository.addRawRows(rawRows);
    }

    if (recordsToUpsert.length > 0) {
      await this.repository.upsertHoldingRecords(recordsToUpsert);
    }

    const completedRun: PortfolioImportRun = {
      ...importRun,
      status: 'success',
      finishedAt: nowIso(),
      importedCount: newRecords.length,
      isUndoable: true,
    };

    await this.repository.updateImportRun(completedRun);

    return {
      accountId: params.accountId,
      importRun: completedRun,
      newRecords: newCount,
      updatedRecords: updatedCount,
      removedRecords: removedCount,
    };
  }

  async syncAllAccounts(params: SyncAllAccountsParams): Promise<ApiSyncSummary> {
    const results: ApiSyncResult[] = [];
    const errors: Array<{ accountId: string; error: PsagotApiError }> = [];

    for (const { accountId, balances } of params.accountBalances) {
      try {
        const result = await this.syncAccount({
          balances,
          providerId: params.providerId,
          providerIntegrationId: params.providerIntegrationId,
          accountId,
          agorotConversion: params.agorotConversion,
        });
        results.push(result);
      } catch (err) {
        errors.push({
          accountId,
          error: toPsagotApiError(err),
        });
      }
    }

    return {
      accountsSynced: results.length,
      totalNewRecords: results.reduce((sum, r) => sum + r.newRecords, 0),
      totalUpdatedRecords: results.reduce((sum, r) => sum + r.updatedRecords, 0),
      totalRemovedRecords: results.reduce((sum, r) => sum + r.removedRecords, 0),
      importRuns: results.map((r) => r.importRun),
      errors,
    };
  }

  /**
   * Undo the last successful sync for the given integration.
   *
   * NOTE: Undo behavior for updated records is destructive. Records that were
   * updated (not newly created) by the sync share the import run ID and will be
   * soft-deleted by undo, rather than restored to their pre-sync values. The
   * user must re-sync to recover current positions. This is intentional for R4
   * (DECISION_LOG #34 / D-API-07: partial-sync is non-rollback by design).
   */
  async undoLastSync(providerIntegrationId: string): Promise<PortfolioImportRun | null> {
    const lastRun = await this.repository.getLastSuccessfulImportRun(providerIntegrationId);
    if (!lastRun || !lastRun.isUndoable) return null;

    const records = await this.repository.listHoldingRecordsByImportRun(lastRun.id);
    const now = nowIso();
    const softDeleted = records.map((record) => ({
      ...record,
      deletedAt: now,
      updatedAt: now,
    }));

    if (softDeleted.length > 0) {
      await this.repository.upsertHoldingRecords(softDeleted);
    }

    const undone: PortfolioImportRun = {
      ...lastRun,
      isUndoable: false,
      undoneAt: now,
    };
    await this.repository.updateImportRun(undone);

    return undone;
  }
}

interface BuildRawRowsParams {
  readonly balances: readonly PsagotBalance[];
  readonly importRunId: string;
  readonly providerId: string;
  readonly providerIntegrationId: string;
}

function buildRawRowsFromBalances(params: BuildRawRowsParams): RawImportRow[] {
  const { balances, importRunId, providerId, providerIntegrationId } = params;
  const createdAt = nowIso();

  return balances.map((balance, index) => {
    const rowPayload = JSON.stringify(balance);
    const rowHash = hashString(rowPayload);
    const rowNumber = index + 1;

    if (!balance.equityNumber || balance.equityNumber.trim() === '') {
      return {
        id: makeId('raw_api'),
        importRunId,
        providerId,
        providerIntegrationId,
        rowNumber,
        rowPayload,
        rowHash,
        isValid: false,
        errorCode: 'MISSING_EQUITY_NUMBER',
        errorMessage: 'Balance has no equity number',
        createdAt,
      };
    }

    if (balance.quantity <= 0) {
      return {
        id: makeId('raw_api'),
        importRunId,
        providerId,
        providerIntegrationId,
        rowNumber,
        rowPayload,
        rowHash,
        isValid: false,
        errorCode: 'INVALID_QUANTITY',
        errorMessage: 'Balance quantity is zero or negative',
        createdAt,
      };
    }

    if (balance.averagePrice <= 0) {
      return {
        id: makeId('raw_api'),
        importRunId,
        providerId,
        providerIntegrationId,
        rowNumber,
        rowPayload,
        rowHash,
        isValid: false,
        errorCode: 'INVALID_AVERAGE_PRICE',
        errorMessage: 'Balance average price is zero or negative',
        createdAt,
      };
    }

    return {
      id: makeId('raw_api'),
      importRunId,
      providerId,
      providerIntegrationId,
      rowNumber,
      rowPayload,
      rowHash,
      isValid: true,
      createdAt,
    };
  });
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function toPsagotApiError(err: unknown): PsagotApiError {
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'message' in err &&
    typeof (err as Record<string, unknown>).type === 'string' &&
    typeof (err as Record<string, unknown>).message === 'string'
  ) {
    return err as PsagotApiError;
  }
  const message = err instanceof Error ? err.message : String(err);
  return { type: 'api_error', message };
}
