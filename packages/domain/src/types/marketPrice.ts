import type { CurrencyCode, ISODateTime } from './common';

export interface TickerMapping {
  readonly securityId: string;
  readonly securityName: string;
  readonly ticker: string | null;
  readonly exchange?: string;
  readonly resolvedAt: ISODateTime;
  readonly resolvedBy: 'auto' | 'manual';
}

export type PriceSource = 'live' | 'stale' | 'csv' | 'unavailable';

export interface EnrichedHoldingsPosition {
  readonly key: string;
  readonly providerId: string;
  readonly securityId: string;
  readonly securityName: string;
  readonly currency: CurrencyCode;
  readonly quantity: number;
  readonly costBasis: number;
  readonly totalCost: number;
  readonly actionDate: string;
  readonly lotCount: number;
  readonly sourceRecordIds: readonly string[];
  readonly sourceImportRunIds: readonly string[];

  readonly ticker?: string;
  readonly livePrice?: number;
  readonly livePriceCurrency?: CurrencyCode;
  readonly livePriceAt?: ISODateTime;
  readonly priceSource: PriceSource;

  readonly currentPrice?: number;
  readonly currentValue?: number;
  readonly unrealizedGain?: number;
  readonly unrealizedGainPct?: number;
}

export interface PriceSummary {
  readonly total: number;
  readonly live: number;
  readonly stale: number;
  readonly csv: number;
  readonly unavailable: number;
}

export interface EnrichedHoldingsState {
  readonly stateType: 'enriched_holdings';
  readonly basedOn: string;
  readonly generatedAt: ISODateTime;
  readonly pricesFetchedAt?: ISODateTime;
  readonly hardFactOnly: false;
  readonly insufficientData: boolean;

  readonly positions: readonly EnrichedHoldingsPosition[];
  readonly positionCount: number;

  readonly valuationTotalsByCurrency: Record<string, number>;
  readonly costTotalsByCurrency: Record<string, number>;
  readonly unrealizedGainTotalsByCurrency: Record<string, number>;

  readonly priceSummary: PriceSummary;
}
