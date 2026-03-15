import type { PortfolioRepository } from '../repositories';
import type { ImportRunSummary, ProviderHoldingRecord, TradeTransaction } from '../types';

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
}
