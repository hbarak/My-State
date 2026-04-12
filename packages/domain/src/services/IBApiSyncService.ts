import type { PortfolioRepository } from '../repositories';
import type {
  IBPosition,
  PortfolioImportRun,
  ProviderHoldingRecord,
} from '../types';
import { makeId, nowIso } from '../utils/idUtils';
import type { AccountService } from './AccountService';
import type { IBApiImportHandler } from './IBApiImportHandler';

interface SyncAccountParams {
  readonly positions: readonly IBPosition[];
  readonly providerId: string;
  readonly providerIntegrationId: string;
  readonly accountId: string;
}

interface SyncAllAccountsParams {
  readonly accountPositions: ReadonlyArray<{
    readonly accountId: string;
    readonly positions: readonly IBPosition[];
  }>;
  readonly providerId: string;
  readonly providerIntegrationId: string;
}

export interface IBSyncResult {
  readonly accountId: string;
  readonly importRun: PortfolioImportRun;
  readonly newRecords: number;
  readonly updatedRecords: number;
  readonly removedRecords: number;
}

export interface IBSyncSummary {
  readonly accountsSynced: number;
  readonly totalNewRecords: number;
  readonly totalUpdatedRecords: number;
  readonly totalRemovedRecords: number;
  readonly importRuns: PortfolioImportRun[];
  readonly errors: ReadonlyArray<{ accountId: string; error: Error }>;
}

export class IBApiSyncService {
  constructor(
    private readonly repository: PortfolioRepository,
    private readonly accountService: AccountService,
    private readonly handler: IBApiImportHandler,
  ) {}

  async syncAccount(params: SyncAccountParams): Promise<IBSyncResult> {
    const startedAt = nowIso();
    const runId = makeId('ib_run');

    const allExisting = await this.repository.listHoldingRecordsByAccount(
      params.providerId,
      params.accountId,
    );
    const existingApiRecords = allExisting.filter(
      (r) => r.providerIntegrationId === params.providerIntegrationId,
    );

    const newRecords = this.handler.mapPositionsToHoldingRecords({
      positions: params.positions,
      providerId: params.providerId,
      providerIntegrationId: params.providerIntegrationId,
      accountId: params.accountId,
      importRunId: runId,
    });

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
        recordsToUpsert.push(record);
        newCount++;
      } else {
        recordsToUpsert.push({ ...record, id: existing.id, createdAt: existing.createdAt });
        updatedCount++;
      }
    }

    const now = nowIso();
    for (const existing of existingApiRecords) {
      if (!newSecurityIds.has(existing.securityId)) {
        recordsToUpsert.push({ ...existing, deletedAt: now, updatedAt: now });
        removedCount++;
      }
    }

    const importRun: PortfolioImportRun = {
      id: runId,
      providerId: params.providerId,
      providerIntegrationId: params.providerIntegrationId,
      accountId: params.accountId,
      sourceName: 'IB Client Portal Sync',
      status: 'running',
      startedAt,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      isUndoable: false,
    };

    await this.repository.addImportRun(importRun);

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

  async syncAllAccounts(params: SyncAllAccountsParams): Promise<IBSyncSummary> {
    const results: IBSyncResult[] = [];
    const errors: Array<{ accountId: string; error: Error }> = [];

    for (const { accountId, positions } of params.accountPositions) {
      try {
        const result = await this.syncAccount({
          positions,
          providerId: params.providerId,
          providerIntegrationId: params.providerIntegrationId,
          accountId,
        });
        results.push(result);
      } catch (err) {
        errors.push({
          accountId,
          error: err instanceof Error ? err : new Error(String(err)),
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
}
