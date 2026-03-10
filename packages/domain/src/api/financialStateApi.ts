import type { PortfolioRepository } from '../repositories';
import { TotalHoldingsStateBuilder } from '../services/TotalHoldingsStateBuilder';
import type { TotalHoldingsPosition, TotalHoldingsState } from '../types';

export interface TotalHoldingsSummary {
  asOf?: string;
  positionCount: number;
  quantityTotalsByCurrency: Record<string, number>;
  valuationTotalsByCurrency: Record<string, number>;
  insufficientData: boolean;
  hardFactOnly: true;
}

export interface ListTotalHoldingsPositionsParams {
  providerId?: string;
  currency?: string;
  securityId?: string;
}

export class FinancialStateApi {
  private readonly builder: TotalHoldingsStateBuilder;

  constructor(repository: PortfolioRepository) {
    this.builder = new TotalHoldingsStateBuilder(repository);
  }

  buildTotalHoldingsState(params?: { providerId?: string }): Promise<TotalHoldingsState> {
    return this.builder.build(params);
  }

  async getTotalHoldingsSummary(params?: { providerId?: string }): Promise<TotalHoldingsSummary> {
    const state = await this.buildTotalHoldingsState(params);
    return {
      asOf: state.asOf,
      positionCount: state.positionCount,
      quantityTotalsByCurrency: state.quantityTotalsByCurrency,
      valuationTotalsByCurrency: state.valuationTotalsByCurrency,
      insufficientData: state.insufficientData,
      hardFactOnly: state.hardFactOnly,
    };
  }

  async listTotalHoldingsPositions(
    params?: ListTotalHoldingsPositionsParams,
  ): Promise<TotalHoldingsPosition[]> {
    const state = await this.buildTotalHoldingsState({ providerId: params?.providerId });

    return state.positions.filter((position) => {
      if (params?.currency && position.currency !== params.currency) return false;
      if (params?.securityId && position.securityId !== params.securityId) return false;
      return true;
    });
  }
}
