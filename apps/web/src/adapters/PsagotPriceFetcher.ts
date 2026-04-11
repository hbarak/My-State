import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';
import type { PsagotApiClient } from '../../../../packages/infra/src/psagot/PsagotApiClient';
import type { PsagotSessionStore } from './PsagotSessionStore';

/**
 * PriceFetcher implementation that fetches real-time prices from Psagot
 * using the market/table/simple endpoint (BaseRate + LastKnownRateDate).
 *
 * Handles two ticker formats:
 * - All-digit equity numbers (e.g. "1183441") — sent directly to fetchMarketRates
 * - Symbol tickers (e.g. "LMND", "SPY") — resolved to equity numbers via autoComplete,
 *   then fetched via fetchMarketRates. Resolved equity numbers are cached in the session
 *   store to avoid redundant lookups on subsequent refreshes.
 *
 * Falls back gracefully: when no session is active or the session expires,
 * returns errors for all tickers so FanOutPriceFetcher routes to EODHD.
 */
export class PsagotPriceFetcher implements PriceFetcher {
  constructor(
    private readonly client: PsagotApiClient,
    private readonly store: PsagotSessionStore,
  ) {}

  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    const session = this.store.getSession();
    if (!session) {
      return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'no_session' }));
    }

    try {
      // Partition: numeric tickers are equity numbers directly; symbols need resolution
      const equityTickers = tickers.filter(isEquityNumber);
      const symbolTickers = tickers.filter((t) => !isEquityNumber(t));

      // Resolve symbols to equity numbers (use cache, fetch missing)
      const symbolToEquity = await this.resolveSymbols(session, symbolTickers);

      // All equity numbers to fetch prices for (deduped)
      const directEquityNumbers = equityTickers;
      const resolvedEquityNumbers = [...symbolToEquity.values()];
      const allEquityNumbers = [...new Set([...directEquityNumbers, ...resolvedEquityNumbers])];

      if (allEquityNumbers.length === 0) {
        // All symbols failed to resolve
        return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'not_found' }));
      }

      const rates = await this.client.fetchMarketRates(session, allEquityNumbers);
      const rateMap = new Map(rates.map((r) => [r.equityNumber, r]));

      return tickers.map((ticker): PriceResult => {
        // For symbol tickers, look up the resolved equity number first
        const equityNumber = isEquityNumber(ticker) ? ticker : symbolToEquity.get(ticker);
        if (!equityNumber) {
          return { ticker, status: 'error', error: 'not_found' };
        }

        const rate = rateMap.get(equityNumber);
        if (!rate || rate.baseRate <= 0) {
          return { ticker, status: 'error', error: 'not_found' };
        }

        const price = rate.baseRate / rate.currencyDivider;
        return {
          ticker,
          status: 'success',
          price,
          currency: rate.currencyCode || 'ILS',
          fetchedAt: rate.lastKnownRateDate,
        };
      });
    } catch {
      this.store.clearSession();
      return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'session_expired' }));
    }
  }

  /**
   * Resolves symbol tickers to equity numbers. Checks cache first, then calls
   * autoComplete for any uncached symbols. Returns a map of symbol → equityNumber
   * for successfully resolved symbols only.
   */
  private async resolveSymbols(
    session: Parameters<PsagotApiClient['resolveTickerToEquityNumber']>[0],
    symbols: readonly string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const toFetch: string[] = [];

    for (const symbol of symbols) {
      const cached = this.store.getCachedEquityNumber(symbol);
      if (cached) {
        result.set(symbol, cached);
      } else {
        toFetch.push(symbol);
      }
    }

    if (toFetch.length === 0) return result;

    // Resolve all uncached symbols in parallel
    const resolved = await Promise.all(
      toFetch.map(async (symbol) => {
        const equityNumber = await this.client.resolveTickerToEquityNumber(session, symbol);
        return { symbol, equityNumber };
      }),
    );

    for (const { symbol, equityNumber } of resolved) {
      if (equityNumber) {
        this.store.setCachedEquityNumber(symbol, equityNumber);
        result.set(symbol, equityNumber);
      }
    }

    return result;
  }
}

/** Returns true for all-digit strings (Psagot equity numbers, e.g. "1183441"). */
function isEquityNumber(ticker: string): boolean {
  return ticker.length > 0 && /^\d+$/.test(ticker);
}
