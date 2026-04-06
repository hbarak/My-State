import type { TotalHoldingsState, TotalHoldingsPosition } from '../types/financialState';
import type {
  EnrichedHoldingsState,
  EnrichedHoldingsPosition,
  PriceSource,
  PriceSummary,
} from '../types/marketPrice';
import type { MarketPriceResult, PriceEntry, PriceRequest } from './MarketPriceService';
import { QuotaExceededError } from './MarketPriceService';
import type { SecurityInput } from './TickerResolverService';
import type { TickerMapping } from '../types/marketPrice';

export interface TickerResolver {
  resolveAll(securities: readonly SecurityInput[]): Promise<ReadonlyMap<string, TickerMapping | null>>;
}

export interface PriceService {
  getPrices(requests: readonly PriceRequest[]): Promise<MarketPriceResult>;
}

export interface StalePriceCache {
  readonly entries: ReadonlyMap<string, PriceEntry>;
}

export interface EnrichResult {
  readonly state: EnrichedHoldingsState;
  readonly updatedCache: StalePriceCache;
}

export class PortfolioPriceEnricher {
  constructor(
    private readonly tickerResolver: TickerResolver,
    private readonly priceService: PriceService,
  ) {}

  async enrich(state: TotalHoldingsState, cache: StalePriceCache = { entries: new Map() }): Promise<EnrichResult> {
    const generatedAt = new Date().toISOString();

    if (state.positions.length === 0) {
      return {
        state: {
          stateType: 'enriched_holdings',
          basedOn: state.snapshotId,
          generatedAt,
          hardFactOnly: false,
          insufficientData: false,
          positions: [],
          positionCount: 0,
          valuationTotalsByCurrency: {},
          costTotalsByCurrency: {},
          unrealizedGainTotalsByCurrency: {},
          priceSummary: { total: 0, live: 0, stale: 0, csv: 0, unavailable: 0 },
        },
        updatedCache: cache,
      };
    }

    // 1. Extract unique securities
    const securities: SecurityInput[] = uniqueSecurities(state.positions);

    // 2. Resolve tickers
    const tickerMap = await this.tickerResolver.resolveAll(securities);

    // 3. Batch-fetch prices for resolved tickers
    const priceRequests: PriceRequest[] = [];
    for (const [securityId, mapping] of tickerMap) {
      if (mapping?.ticker) {
        priceRequests.push({ securityId, ticker: mapping.ticker });
      }
    }

    let priceResult: MarketPriceResult | null = null;
    let priceQuotaExceeded = false;
    if (priceRequests.length > 0) {
      try {
        priceResult = await this.priceService.getPrices(priceRequests);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          priceQuotaExceeded = true;
          // Continue enrichment without prices — positions render with 'unavailable' source
        }
        // Other errors: priceResult stays null
      }
    }

    // Build updated cache with successful fetches (immutable — new Map)
    const updatedEntries = new Map(cache.entries);
    if (priceResult) {
      for (const [securityId, entry] of priceResult.prices) {
        updatedEntries.set(securityId, entry);
      }
    }
    const updatedCache: StalePriceCache = { entries: updatedEntries };

    // 4. Enrich each position
    const enrichedPositions: EnrichedHoldingsPosition[] = state.positions.map((pos) => {
      const mapping = tickerMap.get(pos.securityId);
      const liveEntry = priceResult?.prices.get(pos.securityId);
      return enrichPosition(
        pos,
        mapping ?? null,
        liveEntry ?? null,
        updatedEntries.get(pos.securityId) ?? null,
        priceResult?.fetchedAt,
      );
    });

    // 5. Aggregate totals by currency
    const valuationTotals: Record<string, number> = {};
    const costTotals: Record<string, number> = {};
    const gainTotals: Record<string, number> = {};

    for (const ep of enrichedPositions) {
      costTotals[ep.currency] = (costTotals[ep.currency] ?? 0) + ep.totalCost;
      if (ep.currentValue !== undefined) {
        valuationTotals[ep.currency] = (valuationTotals[ep.currency] ?? 0) + ep.currentValue;
      }
      if (ep.unrealizedGain !== undefined) {
        gainTotals[ep.currency] = (gainTotals[ep.currency] ?? 0) + ep.unrealizedGain;
      }
    }

    // 6. Price summary
    const summary: PriceSummary = {
      total: enrichedPositions.length,
      live: enrichedPositions.filter((p) => p.priceSource === 'live').length,
      stale: enrichedPositions.filter((p) => p.priceSource === 'stale').length,
      csv: enrichedPositions.filter((p) => p.priceSource === 'csv').length,
      unavailable: enrichedPositions.filter((p) => p.priceSource === 'unavailable').length,
    };

    const insufficientData = enrichedPositions.some((p) => p.priceSource === 'unavailable');

    return {
      state: {
        stateType: 'enriched_holdings',
        basedOn: state.snapshotId,
        generatedAt,
        pricesFetchedAt: priceResult?.fetchedAt,
        hardFactOnly: false,
        insufficientData,
        priceQuotaExceeded: priceQuotaExceeded || undefined,
        positions: enrichedPositions,
        positionCount: enrichedPositions.length,
        valuationTotalsByCurrency: valuationTotals,
        costTotalsByCurrency: costTotals,
        unrealizedGainTotalsByCurrency: gainTotals,
        priceSummary: summary,
      },
      updatedCache,
    };
  }
}

function enrichPosition(
  pos: TotalHoldingsPosition,
  mapping: TickerMapping | null,
  liveEntry: PriceEntry | null,
  staleEntry: PriceEntry | null,
  fetchedAt?: string,
): EnrichedHoldingsPosition {
  const ticker = mapping?.ticker ?? undefined;

  // Determine price via fallback chain
  let currentPrice: number | undefined;
  let priceSource: PriceSource;
  let livePriceAt: string | undefined;
  let livePriceCurrency: string | undefined;
  let livePrice: number | undefined;

  if (liveEntry) {
    priceSource = 'live';
    currentPrice = liveEntry.price;
    livePrice = liveEntry.price;
    livePriceCurrency = liveEntry.currency;
    livePriceAt = fetchedAt;
  } else if (staleEntry && staleEntry !== liveEntry) {
    priceSource = 'stale';
    currentPrice = staleEntry.price;
  } else if (typeof pos.currentPrice === 'number' && pos.currentPrice > 0) {
    priceSource = 'csv';
    currentPrice = pos.currentPrice;
  } else {
    priceSource = 'unavailable';
    currentPrice = undefined;
  }

  const currentValue = currentPrice !== undefined ? pos.quantity * currentPrice : undefined;
  const unrealizedGain = currentValue !== undefined ? currentValue - pos.totalCost : undefined;
  const unrealizedGainPct =
    unrealizedGain !== undefined && pos.totalCost > 0
      ? unrealizedGain / pos.totalCost
      : undefined;

  return {
    key: pos.key,
    providerId: pos.providerId,
    securityId: pos.securityId,
    securityName: pos.securityName,
    currency: pos.currency,
    quantity: pos.quantity,
    costBasis: pos.costBasis,
    totalCost: pos.totalCost,
    actionDate: pos.actionDate,
    lotCount: pos.lotCount,
    sourceRecordIds: pos.sourceRecordIds,
    sourceImportRunIds: pos.sourceImportRunIds,
    accountIds: pos.accountIds ?? [],
    ticker,
    livePrice,
    livePriceCurrency,
    livePriceAt,
    priceSource,
    currentPrice,
    currentValue,
    unrealizedGain,
    unrealizedGainPct,
  };
}

function uniqueSecurities(positions: readonly TotalHoldingsPosition[]): SecurityInput[] {
  const seen = new Set<string>();
  const result: SecurityInput[] = [];
  for (const pos of positions) {
    if (!seen.has(pos.securityId)) {
      seen.add(pos.securityId);
      result.push({ securityId: pos.securityId, securityName: pos.securityName });
    }
  }
  return result;
}
