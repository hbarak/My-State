import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';

// ─────────────────────────────────────────────────────────────────────────────
// Route-based price fetcher
//
// Each route declares:
//   name        — identifier, used for updateKnownTickers()
//   canHandle   — predicate: does this route own this ticker?
//   fetcher     — the PriceFetcher to call
//   exclusive   — if true, tickers matched here are NOT also sent to the fallback fetcher
//                 if false, fallback is tried in parallel and used when this route fails
//
// Routing algorithm:
//   1. For each ticker, find the first matching exclusive route → that fetcher only
//   2. If a non-exclusive route matches, send to that route AND fallback in parallel
//      → route result wins if successful; fallback is the safety net
//   3. If no route matches, send to fallback only
//
// Current route setup (see bootstrap.ts):
//   - Psagot equity numbers (explicit, from sync)  exclusive  → PsagotPriceFetcher
//   - TASE all-digit numeric IDs                   exclusive  → MayaPriceFetcher
//   - Symbol tickers (AAPL, DLEKG.TA, etc.)        non-excl   → PsagotPriceFetcher + EODHD parallel
//
// Adding a new provider (e.g. IB):
//   1. Create an IBPriceFetcher implementing PriceFetcher
//   2. Add a route: { name: 'ib', canHandle: isConid, fetcher: ibFetcher, exclusive: true }
//   3. Call fanOut.updateKnownTickers('ib', conidSet) after IB sync
// ─────────────────────────────────────────────────────────────────────────────

export interface PriceFetcherRoute {
  /** Identifier — used with updateKnownTickers() */
  readonly name: string;
  /** Returns true if this route should handle the ticker */
  readonly canHandle: (ticker: string) => boolean;
  readonly fetcher: PriceFetcher;
  /**
   * If true: tickers matched here go only to this fetcher (no fallback in parallel).
   * Use for known-good IDs (equity numbers, conids) where the fallback wouldn't know them anyway.
   *
   * If false: tickers matched here are also sent to the fallback fetcher simultaneously.
   * Use when the route may fail (session-dependent) and the fallback is a valid alternative.
   */
  readonly exclusive: boolean;
}

/**
 * Composite PriceFetcher that routes tickers across multiple data sources.
 *
 * @param routes    Ordered list of routes. First exclusive match wins.
 *                  Non-exclusive routes run in parallel with the fallback fetcher.
 * @param fallback  The default fetcher (EODHD). Handles anything not exclusively claimed,
 *                  and acts as the safety net for failed non-exclusive routes.
 */
export class FanOutPriceFetcher implements PriceFetcher {
  private readonly knownTickers = new Map<string, ReadonlySet<string>>();

  constructor(
    private readonly routes: readonly PriceFetcherRoute[],
    private readonly fallback: PriceFetcher,
  ) {}

  /**
   * Update the set of tickers a named route exclusively owns.
   * Typically called after a provider sync (e.g. Psagot equity numbers after holdings sync).
   */
  updateKnownTickers(routeName: string, tickers: ReadonlySet<string>): void {
    this.knownTickers.set(routeName, tickers);
  }

  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    // Partition tickers into buckets per exclusive route, non-exclusive, and fallback-only
    const exclusiveBuckets = new Map<PriceFetcherRoute, string[]>();
    const nonExclusiveTickers: string[] = [];
    const fallbackOnlyTickers: string[] = [];

    for (const ticker of tickers) {
      const exclusiveRoute = this.routes.find(
        (r) => r.exclusive && this.routeCanHandle(r, ticker),
      );
      if (exclusiveRoute) {
        if (!exclusiveBuckets.has(exclusiveRoute)) exclusiveBuckets.set(exclusiveRoute, []);
        exclusiveBuckets.get(exclusiveRoute)!.push(ticker);
      } else if (this.routes.some((r) => !r.exclusive && this.routeCanHandle(r, ticker))) {
        nonExclusiveTickers.push(ticker);
      } else {
        fallbackOnlyTickers.push(ticker);
      }
    }

    // --- Exclusive routes (each fetched independently, fallback on error) ---
    const exclusiveResults: PriceResult[] = [];
    const tickersNeedingFallback: string[] = [];

    await Promise.all(
      [...exclusiveBuckets.entries()].map(async ([route, routeTickers]) => {
        const results = await route.fetcher.fetchPrices(routeTickers);
        for (const r of results) {
          if (r.status === 'error') {
            tickersNeedingFallback.push(r.ticker);
          } else {
            exclusiveResults.push(r);
          }
        }
      }),
    );

    if (tickersNeedingFallback.length > 0) {
      const fallback = await this.fallback.fetchPrices(tickersNeedingFallback);
      exclusiveResults.push(...fallback);
    }

    // --- Non-exclusive tickers: matching routes + fallback in parallel ---
    const nonExclusiveResults: PriceResult[] = [];

    if (nonExclusiveTickers.length > 0) {
      const matchingRoutes = this.routes.filter(
        (r) => !r.exclusive && nonExclusiveTickers.some((t) => this.routeCanHandle(r, t)),
      );

      const [routeResultSets, fallbackResults] = await Promise.all([
        Promise.all(
          matchingRoutes.map((r) =>
            r.fetcher.fetchPrices(nonExclusiveTickers.filter((t) => this.routeCanHandle(r, t))),
          ),
        ),
        this.fallback.fetchPrices(nonExclusiveTickers),
      ]);

      const fallbackMap = new Map(fallbackResults.map((r) => [r.ticker, r]));

      for (const ticker of nonExclusiveTickers) {
        let winner: PriceResult | undefined;
        for (const routeResults of routeResultSets) {
          const match = routeResults.find((r) => r.ticker === ticker && r.status === 'success');
          if (match) { winner = match; break; }
        }
        nonExclusiveResults.push(
          winner ?? fallbackMap.get(ticker) ?? { ticker, status: 'error' as const, error: 'not_found' },
        );
      }
    }

    // --- Fallback-only tickers ---
    const fallbackOnlyResults =
      fallbackOnlyTickers.length > 0
        ? await this.fallback.fetchPrices(fallbackOnlyTickers)
        : [];

    return [...exclusiveResults, ...nonExclusiveResults, ...fallbackOnlyResults];
  }

  private routeCanHandle(route: PriceFetcherRoute, ticker: string): boolean {
    const known = this.knownTickers.get(route.name);
    if (known !== undefined) {
      return known.has(ticker) || route.canHandle(ticker);
    }
    return route.canHandle(ticker);
  }
}

/**
 * Returns true if the ticker is a TASE numeric fund ID (all digits, e.g. "1183441").
 * These are routed to the Maya TASE API instead of EODHD.
 *
 * Exported for unit testing.
 */
export function isTaseNumericId(ticker: string): boolean {
  return ticker.length > 0 && /^\d+$/.test(ticker);
}
