import type { ProviderHoldingRecord } from '../types';

export interface AggregatedLotResult {
  readonly totalQuantity: number;
  readonly totalCost: number;
  readonly weightedAvgCostBasis: number;
  readonly latestCurrentPrice: number | undefined;
  readonly latestActionDate: string;
}

/**
 * Aggregates holding lots into totals: quantity, cost, weighted avg cost basis,
 * and latest current price (by explicit action date comparison).
 *
 * Shared by TotalHoldingsStateBuilder and SecurityLotQueryService to prevent drift.
 */
export function aggregateHoldingLots(lots: readonly ProviderHoldingRecord[]): AggregatedLotResult {
  let totalQuantity = 0;
  let totalCost = 0;
  let latestActionDate = '';
  let latestCurrentPrice: number | undefined;
  let latestActionDateForPrice = '';

  for (const lot of lots) {
    totalQuantity += lot.quantity;
    totalCost += lot.costBasis * lot.quantity;

    if (lot.actionDate > latestActionDate) {
      latestActionDate = lot.actionDate;
    }

    if (typeof lot.currentPrice === 'number') {
      if (lot.actionDate > latestActionDateForPrice || latestCurrentPrice === undefined) {
        latestCurrentPrice = lot.currentPrice;
        latestActionDateForPrice = lot.actionDate;
      }
    }
  }

  const weightedAvgCostBasis = totalQuantity > 0 ? totalCost / totalQuantity : 0;

  return {
    totalQuantity,
    totalCost,
    weightedAvgCostBasis,
    latestCurrentPrice,
    latestActionDate,
  };
}
