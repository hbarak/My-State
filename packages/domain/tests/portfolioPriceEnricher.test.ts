import { describe, expect, it } from 'vitest';
import { PortfolioPriceEnricher } from '../src/services/PortfolioPriceEnricher';
import type { TotalHoldingsState, TotalHoldingsPosition } from '../src/types/financialState';
import type { TickerMapping } from '../src/types/marketPrice';
import type { MarketPriceResult, PriceEntry, PriceError, PriceRequest } from '../src/services/MarketPriceService';
import type { SecurityInput } from '../src/services/TickerResolverService';

// --- Stub factories ---

function makePosition(overrides: Partial<TotalHoldingsPosition> & { securityId: string }): TotalHoldingsPosition {
  return {
    key: overrides.key ?? `pos-${overrides.securityId}`,
    providerId: overrides.providerId ?? 'provider-1',
    securityId: overrides.securityId,
    securityName: overrides.securityName ?? `Security ${overrides.securityId}`,
    currency: overrides.currency ?? 'ILS',
    quantity: overrides.quantity ?? 100,
    costBasis: overrides.costBasis ?? 50,
    totalCost: overrides.totalCost ?? 5000,
    currentPrice: overrides.currentPrice,
    actionDate: overrides.actionDate ?? '2026-01-15',
    lotCount: overrides.lotCount ?? 1,
    sourceRecordIds: overrides.sourceRecordIds ?? ['rec-1'],
    sourceImportRunIds: overrides.sourceImportRunIds ?? ['run-1'],
    accountIds: overrides.accountIds ?? ['default'],
  };
}

function makeHoldingsState(positions: TotalHoldingsPosition[]): TotalHoldingsState {
  const valuationTotals: Record<string, number> = {};
  const quantityTotals: Record<string, number> = {};
  for (const p of positions) {
    valuationTotals[p.currency] = (valuationTotals[p.currency] ?? 0) + p.totalCost;
    quantityTotals[p.currency] = (quantityTotals[p.currency] ?? 0) + p.quantity;
  }
  return {
    stateType: 'total_holdings',
    snapshotId: 'snap-001',
    recordSetHash: 'hash-001',
    generatedAt: '2026-03-15T10:00:00Z',
    hardFactOnly: true,
    insufficientData: false,
    positionCount: positions.length,
    positions,
    quantityTotalsByCurrency: quantityTotals,
    valuationTotalsByCurrency: valuationTotals,
    sourceRunIds: ['run-1'],
  };
}

function makeMapping(securityId: string, ticker: string | null): TickerMapping {
  return {
    securityId,
    securityName: `Security ${securityId}`,
    ticker,
    resolvedAt: '2026-03-15T10:00:00Z',
    resolvedBy: 'auto',
  };
}

interface StubResolverConfig {
  mappings: Record<string, TickerMapping | null>;
}

function stubResolver(config: StubResolverConfig) {
  return {
    async resolveAll(securities: readonly SecurityInput[]): Promise<ReadonlyMap<string, TickerMapping | null>> {
      const result = new Map<string, TickerMapping | null>();
      for (const sec of securities) {
        result.set(sec.securityId, config.mappings[sec.securityId] ?? null);
      }
      return result;
    },
  };
}

interface StubPriceServiceConfig {
  prices: Record<string, PriceEntry>;
  errors?: PriceError[];
  shouldThrow?: Error;
}

function stubPriceService(config: StubPriceServiceConfig) {
  return {
    async getPrices(requests: readonly PriceRequest[]): Promise<MarketPriceResult> {
      if (config.shouldThrow) throw config.shouldThrow;
      const prices = new Map<string, PriceEntry>();
      const errors: PriceError[] = config.errors ? [...config.errors] : [];
      for (const req of requests) {
        const entry = config.prices[req.securityId];
        if (entry) {
          prices.set(req.securityId, entry);
        } else {
          errors.push({ securityId: req.securityId, ticker: req.ticker, reason: 'not_found' });
        }
      }
      return { fetchedAt: '2026-03-15T10:01:00Z', prices, errors };
    },
  };
}

describe('PortfolioPriceEnricher', () => {
  it('enriches all positions with live prices when all resolve and fetch', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100 }),
      makePosition({ securityId: '1002', totalCost: 3000, quantity: 50 }),
    ];
    const state = makeHoldingsState(positions);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({
        mappings: {
          '1001': makeMapping('1001', 'AAA.TA'),
          '1002': makeMapping('1002', 'BBB.TA'),
        },
      }),
      stubPriceService({
        prices: {
          '1001': { price: 60, currency: 'ILS' },
          '1002': { price: 80, currency: 'ILS' },
        },
      }),
    );

    const { state: result } = await enricher.enrich(state);

    expect(result.stateType).toBe('enriched_holdings');
    expect(result.hardFactOnly).toBe(false);
    expect(result.basedOn).toBe('snap-001');
    expect(result.insufficientData).toBe(false);
    expect(result.positionCount).toBe(2);

    const p1 = result.positions.find((p) => p.securityId === '1001')!;
    expect(p1.priceSource).toBe('live');
    expect(p1.currentPrice).toBe(60);
    expect(p1.currentValue).toBe(6000); // 100 * 60
    expect(p1.unrealizedGain).toBe(1000); // 6000 - 5000
    expect(p1.unrealizedGainPct).toBeCloseTo(0.2); // 1000 / 5000

    const p2 = result.positions.find((p) => p.securityId === '1002')!;
    expect(p2.currentPrice).toBe(80);
    expect(p2.currentValue).toBe(4000); // 50 * 80

    expect(result.priceSummary.live).toBe(2);
    expect(result.priceSummary.unavailable).toBe(0);
  });

  it('falls back to CSV price when ticker is unresolved — insufficientData = false', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100, currentPrice: 45 }),
    ];
    const state = makeHoldingsState(positions);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({ mappings: { '1001': makeMapping('1001', null) } }),
      stubPriceService({ prices: {} }),
    );

    const { state: result } = await enricher.enrich(state);

    expect(result.insufficientData).toBe(false);
    const p = result.positions[0];
    expect(p.priceSource).toBe('csv');
    expect(p.currentPrice).toBe(45);
    expect(p.currentValue).toBe(4500); // 100 * 45
  });

  it('all positions at cost-basis-only when entire fetch fails — insufficientData = true', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100 }),
      makePosition({ securityId: '1002', totalCost: 3000, quantity: 50 }),
    ];
    const state = makeHoldingsState(positions);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({
        mappings: {
          '1001': makeMapping('1001', 'AAA.TA'),
          '1002': makeMapping('1002', 'BBB.TA'),
        },
      }),
      stubPriceService({ prices: {}, shouldThrow: new Error('Network down') }),
    );

    const { state: result } = await enricher.enrich(state);

    expect(result.insufficientData).toBe(true);
    for (const p of result.positions) {
      expect(p.priceSource).toBe('unavailable');
      expect(p.currentPrice).toBeUndefined();
      expect(p.currentValue).toBeUndefined();
    }
    expect(result.priceSummary.unavailable).toBe(2);
    expect(result.priceSummary.live).toBe(0);
  });

  it('stored ProviderHoldingRecord immutability — original state is not mutated', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100 }),
    ];
    const state = makeHoldingsState(positions);
    const originalStateJson = JSON.stringify(state);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({ mappings: { '1001': makeMapping('1001', 'AAA.TA') } }),
      stubPriceService({ prices: { '1001': { price: 60, currency: 'ILS' } } }),
    );

    const { state: result } = await enricher.enrich(state);

    // Original state must be unchanged
    expect(JSON.stringify(state)).toBe(originalStateJson);
    // Result must be a different object
    expect(result).not.toBe(state);
    expect(result.stateType).toBe('enriched_holdings');
  });

  it('does not mix currencies — price in different currency than position', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100, currency: 'ILS' }),
      makePosition({ securityId: '1002', totalCost: 2000, quantity: 20, currency: 'USD' }),
    ];
    const state = makeHoldingsState(positions);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({
        mappings: {
          '1001': makeMapping('1001', 'AAA.TA'),
          '1002': makeMapping('1002', 'AAPL'),
        },
      }),
      stubPriceService({
        prices: {
          '1001': { price: 60, currency: 'ILS' },
          '1002': { price: 185, currency: 'USD' },
        },
      }),
    );

    const { state: result } = await enricher.enrich(state);

    // ILS totals
    expect(result.valuationTotalsByCurrency['ILS']).toBe(6000); // 100 * 60
    expect(result.costTotalsByCurrency['ILS']).toBe(5000);
    expect(result.unrealizedGainTotalsByCurrency['ILS']).toBe(1000);

    // USD totals
    expect(result.valuationTotalsByCurrency['USD']).toBe(3700); // 20 * 185
    expect(result.costTotalsByCurrency['USD']).toBe(2000);
    expect(result.unrealizedGainTotalsByCurrency['USD']).toBe(1700);
  });

  it('populates pricesFetchedAt on enriched positions', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100 }),
    ];
    const state = makeHoldingsState(positions);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({ mappings: { '1001': makeMapping('1001', 'AAA.TA') } }),
      stubPriceService({ prices: { '1001': { price: 60, currency: 'ILS' } } }),
    );

    const { state: result } = await enricher.enrich(state);

    expect(result.pricesFetchedAt).toBeDefined();
    const p = result.positions[0];
    expect(p.livePriceAt).toBeDefined();
  });

  it('per-entry fetchedAt: livePriceAt comes from PriceEntry.fetchedAt when present', async () => {
    const entryFetchedAt = '2026-01-10T09:00:00Z';
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100 }),
      makePosition({ securityId: '1002', totalCost: 3000, quantity: 50 }),
    ];
    const state = makeHoldingsState(positions);

    // Price service returns entries with per-entry fetchedAt (different timestamps)
    const customPriceService = {
      async getPrices(requests: readonly PriceRequest[]): Promise<MarketPriceResult> {
        const prices = new Map<string, PriceEntry>();
        for (const req of requests) {
          if (req.securityId === '1001') {
            prices.set('1001', { price: 60, currency: 'ILS', fetchedAt: entryFetchedAt });
          } else {
            prices.set('1002', { price: 80, currency: 'ILS', fetchedAt: '2026-01-10T08:00:00Z' });
          }
        }
        return { fetchedAt: '2026-01-10T09:30:00Z', prices, errors: [] };
      },
    };

    const enricher = new PortfolioPriceEnricher(
      stubResolver({
        mappings: {
          '1001': makeMapping('1001', 'AAA.TA'),
          '1002': makeMapping('1002', 'BBB.TA'),
        },
      }),
      customPriceService,
    );

    const { state: result } = await enricher.enrich(state);

    const p1 = result.positions.find((p) => p.securityId === '1001')!;
    const p2 = result.positions.find((p) => p.securityId === '1002')!;
    expect(p1.livePriceAt).toBe(entryFetchedAt);
    expect(p2.livePriceAt).toBe('2026-01-10T08:00:00Z');
  });

  it('handles empty TotalHoldingsState without errors', async () => {
    const state = makeHoldingsState([]);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({ mappings: {} }),
      stubPriceService({ prices: {} }),
    );

    const { state: result } = await enricher.enrich(state);

    expect(result.positionCount).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.insufficientData).toBe(false);
    expect(result.priceSummary.total).toBe(0);
  });

  it('GAP-01: stale cache fallback — second fetch fails, uses cached price from first fetch', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100 }),
    ];
    const state = makeHoldingsState(positions);

    let callCount = 0;
    const failOnSecondCall = {
      async getPrices(requests: readonly PriceRequest[]): Promise<MarketPriceResult> {
        callCount++;
        if (callCount === 1) {
          const prices = new Map<string, PriceEntry>();
          prices.set('1001', { price: 60, currency: 'ILS' });
          return { fetchedAt: '2026-03-15T10:01:00Z', prices, errors: [] };
        }
        throw new Error('Yahoo Finance unavailable');
      },
    };

    const enricher = new PortfolioPriceEnricher(
      stubResolver({ mappings: { '1001': makeMapping('1001', 'AAA.TA') } }),
      failOnSecondCall,
    );

    // First call — live price succeeds, populates cache
    const first = await enricher.enrich(state);
    expect(first.state.positions[0].priceSource).toBe('live');
    expect(first.state.positions[0].currentPrice).toBe(60);

    // Second call — fetch throws, falls back to stale cache from first call
    const second = await enricher.enrich(state, first.updatedCache);
    expect(second.state.positions[0].priceSource).toBe('stale');
    expect(second.state.positions[0].currentPrice).toBe(60);
    expect(second.state.positions[0].livePrice).toBeUndefined();
    expect(second.state.positions[0].livePriceCurrency).toBeUndefined();
    expect(second.state.priceSummary.stale).toBe(1);
    expect(second.state.priceSummary.live).toBe(0);
    expect(second.state.insufficientData).toBe(false);
  });

  it('returns new object — original TotalHoldingsState is not mutated (immutability)', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100, currentPrice: 45 }),
    ];
    const state = makeHoldingsState(positions);

    // Deep-freeze the original to detect mutation attempts
    const frozenPositions = Object.freeze(state.positions.map((p) => Object.freeze({ ...p })));
    const frozenState = Object.freeze({ ...state, positions: frozenPositions });

    const enricher = new PortfolioPriceEnricher(
      stubResolver({ mappings: { '1001': makeMapping('1001', 'AAA.TA') } }),
      stubPriceService({ prices: { '1001': { price: 60, currency: 'ILS' } } }),
    );

    // Should not throw even with frozen input
    const { state: result } = await enricher.enrich(frozenState as TotalHoldingsState);

    expect(result.positions[0].currentPrice).toBe(60);
    expect(result.stateType).toBe('enriched_holdings');
  });

  // PE1: EnrichedHoldingsPosition carries accountIds from TotalHoldingsPosition unchanged
  it('PE1: enriched position carries accountIds unchanged', async () => {
    const positions = [
      makePosition({ securityId: '1001', totalCost: 5000, quantity: 100, accountIds: ['acct-a', 'acct-b'] }),
    ];
    const state = makeHoldingsState(positions);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({ mappings: { '1001': makeMapping('1001', 'AAA.TA') } }),
      stubPriceService({ prices: { '1001': { price: 60, currency: 'ILS' } } }),
    );

    const { state: result } = await enricher.enrich(state);

    expect(result.positions[0].accountIds).toEqual(['acct-a', 'acct-b']);
  });

  // PE2: Multi-account position gets single price applied, accountIds preserved
  it('PE2: multi-account position gets single price, accountIds preserved', async () => {
    const positions = [
      makePosition({ securityId: '2001', totalCost: 10000, quantity: 200, accountIds: ['joint', 'ira', 'taxable'] }),
    ];
    const state = makeHoldingsState(positions);

    const enricher = new PortfolioPriceEnricher(
      stubResolver({ mappings: { '2001': makeMapping('2001', 'LEUMI.TA') } }),
      stubPriceService({ prices: { '2001': { price: 55, currency: 'ILS' } } }),
    );

    const { state: result } = await enricher.enrich(state);
    const enriched = result.positions[0];

    expect(enriched.accountIds).toEqual(['joint', 'ira', 'taxable']);
    expect(enriched.currentPrice).toBe(55);
    expect(enriched.currentValue).toBe(200 * 55);
    expect(enriched.priceSource).toBe('live');
  });
});
