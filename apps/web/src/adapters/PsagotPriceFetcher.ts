import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';
import type { PsagotApiClient } from '../../../../packages/infra/src/psagot/PsagotApiClient';
import type { PsagotSessionStore } from './PsagotSessionStore';

/**
 * PriceFetcher implementation that fetches real-time prices from Psagot
 * using the market/table/simple endpoint (BaseRate + LastKnownRateDate).
 *
 * Advantages over the fetchBalances() approach:
 * - Single request for all tickers (no per-account iteration)
 * - No 1.1s delays between accounts
 * - Works for any equity number, not just currently-held positions
 * - PriceEntry.fetchedAt is set from LastKnownRateDate (exchange timestamp),
 *   not the time of the HTTP call — more accurate for freshness classification
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
      const rates = await this.client.fetchMarketRates(session, tickers);
      const rateMap = new Map(rates.map((r) => [r.equityNumber, r]));

      return tickers.map((ticker): PriceResult => {
        const rate = rateMap.get(ticker);
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
}
