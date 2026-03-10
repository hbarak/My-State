import type { PortfolioRepository } from '../repositories';
import { FinancialStateApi } from '../api/financialStateApi';
import type { NetWorthState, TotalHoldingsState } from '../types';

export class FinancialStateService {
  private readonly api: FinancialStateApi;

  constructor(repository: PortfolioRepository) {
    this.api = new FinancialStateApi(repository);
  }

  getTotalHoldingsState(params?: { providerId?: string }): Promise<TotalHoldingsState> {
    return this.api.buildTotalHoldingsState(params);
  }

  async getNetWorthState(params?: { providerId?: string }): Promise<NetWorthState> {
    const holdings = await this.getTotalHoldingsState(params);

    return {
      stateType: 'net_worth',
      generatedAt: new Date().toISOString(),
      asOf: holdings.asOf,
      hardFactOnly: true,
      insufficientData: true,
      holdingsValuationTotalsByCurrency: holdings.valuationTotalsByCurrency,
      notes: [
        'Cash domain is not integrated yet; net worth totals are intentionally withheld.',
        'No implicit cash assumptions are applied from trades or holdings.',
      ],
    };
  }
}
