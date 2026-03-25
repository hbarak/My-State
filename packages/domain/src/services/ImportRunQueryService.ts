import type { PortfolioRepository } from '../repositories';
import type { ImportRunListItem, ImportRunSummary, ProviderHoldingRecord, RawImportRow, TradeTransaction } from '../types';

export class ImportRunQueryService {
  constructor(private readonly repository: PortfolioRepository) {}

  async getRunSummary(runId: string): Promise<ImportRunSummary | null> {
    const runs = await this.repository.listImportRuns();
    const run = runs.find((r) => r.id === runId);
    if (!run) return null;

    const rawRows = await this.repository.listRawRowsByImportRun(runId);

    let valid = 0;
    let invalid = 0;
    let duplicate = 0;
    for (const row of rawRows) {
      if (!row.isValid && row.errorCode && row.errorCode.startsWith('DUPLICATE')) {
        duplicate++;
      } else if (!row.isValid) {
        invalid++;
      } else {
        valid++;
      }
    }

    const lots = await this.repository.listHoldingRecordsByImportRun(runId);
    const trades = await this.repository.listTradesByImportRun(runId);

    return {
      run,
      rawRowCounts: { total: rawRows.length, valid, invalid, duplicate },
      lotCount: lots.length,
      tradeCount: trades.length,
    };
  }

  async listLotsForRun(runId: string): Promise<ProviderHoldingRecord[]> {
    return this.repository.listHoldingRecordsByImportRun(runId);
  }

  async listTradesForRun(runId: string): Promise<TradeTransaction[]> {
    return this.repository.listTradesByImportRun(runId);
  }

  async listAllRuns(): Promise<ImportRunListItem[]> {
    const runs = await this.repository.listImportRuns();

    const items: ImportRunListItem[] = await Promise.all(
      runs.map(async (run) => {
        const integration = await this.repository.getIntegrationById(run.providerIntegrationId);
        const communicationMethod = integration?.communicationMethod ?? 'document_csv';
        const sourceType: 'csv' | 'api' =
          communicationMethod === 'api_pull' || communicationMethod === 'api_webhook'
            ? 'api'
            : 'csv';

        let accountLabel: string;
        if (run.accountId) {
          const account = await this.repository.getAccount(run.providerId, run.accountId);
          accountLabel = account?.name ?? run.accountId;
        } else {
          accountLabel = 'default';
        }

        const rawRows = await this.repository.listRawRowsByImportRun(run.id);
        let rawRowCounts: ImportRunListItem['rawRowCounts'] = null;
        if (rawRows.length > 0) {
          let valid = 0;
          let invalid = 0;
          let duplicate = 0;
          for (const row of rawRows) {
            if (!row.isValid && row.errorCode && row.errorCode.startsWith('DUPLICATE')) {
              duplicate++;
            } else if (!row.isValid) {
              invalid++;
            } else {
              valid++;
            }
          }
          rawRowCounts = { total: rawRows.length, valid, invalid, duplicate };
        }

        return { run, sourceType, accountLabel, rawRowCounts };
      }),
    );

    return items.sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
  }

  async listRawRowsForRun(runId: string): Promise<RawImportRow[]> {
    return this.repository.listRawRowsByImportRun(runId);
  }
}
