import type { PortfolioRepository } from '../repositories';
import { FinancialStateApi } from '../api/financialStateApi';
import type { NetWorthState, TotalHoldingsState } from '../types';
import type { EnrichedHoldingsState } from '../types/marketPrice';
import type { PortfolioPriceEnricher } from './PortfolioPriceEnricher';

export class FinancialStateService {
  private readonly api: FinancialStateApi;
  private enricher?: PortfolioPriceEnricher;

  constructor(repository: PortfolioRepository, enricher?: PortfolioPriceEnricher) {
    this.api = new FinancialStateApi(repository);
    this.enricher = enricher;
  }

  setEnricher(enricher: PortfolioPriceEnricher): void {
    this.enricher = enricher;
  }

  getTotalHoldingsState(params?: { providerId?: string }): Promise<TotalHoldingsState> {
    return this.api.buildTotalHoldingsState(params);
  }

  async getEnrichedHoldings(params?: { providerId?: string }): Promise<EnrichedHoldingsState> {
    if (!this.enricher) {
      throw new Error('PortfolioPriceEnricher not configured. Call setEnricher() or pass enricher to constructor.');
    }
    const holdingsState = await this.getTotalHoldingsState(params);
    return this.enricher.enrich(holdingsState);
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
