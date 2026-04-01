import type { PortfolioRepository } from '../repositories';
import { TotalHoldingsStateBuilder } from '../services/TotalHoldingsStateBuilder';
import type { TotalHoldingsPosition, TotalHoldingsState } from '../types';

async function resolveApiIntegrationIds(
  repository: PortfolioRepository,
  providerId?: string,
): Promise<ReadonlySet<string>> {
  if (!providerId) {
    const providers = await repository.getProviders();
    const allIntegrations = await Promise.all(
      providers.map((p) => repository.listIntegrations(p.id)),
    );
    return new Set(
      allIntegrations.flat().filter((i) => i.kind === 'api').map((i) => i.id),
    );
  }
  const integrations = await repository.listIntegrations(providerId);
  return new Set(integrations.filter((i) => i.kind === 'api').map((i) => i.id));
}

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
  private readonly repository: PortfolioRepository;

  constructor(repository: PortfolioRepository) {
    this.repository = repository;
    this.builder = new TotalHoldingsStateBuilder(repository);
  }

  async buildTotalHoldingsState(params?: { providerId?: string }): Promise<TotalHoldingsState> {
    const apiIntegrationIds = await resolveApiIntegrationIds(this.repository, params?.providerId);
    return this.builder.build({ ...params, apiIntegrationIds });
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
