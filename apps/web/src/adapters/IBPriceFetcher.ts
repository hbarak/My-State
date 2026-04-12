import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';
import type { IBApiClient } from '../../../../packages/infra/src/ib/IBApiClient';
import type { IBSessionStore } from './IBSessionStore';

/**
 * PriceFetcher implementation that fetches real-time prices from the
 * IB Client Portal Gateway via market data snapshots.
 *
 * Only handles tickers that are IB conids (numeric strings known from
 * the last IB positions sync). Unknown or non-conid tickers return errors
 * so FanOutPriceFetcher routes them elsewhere (EODHD).
 *
 * Requires an active gateway session (user logged in at localhost:5000).
 * On session loss, clears auth state and returns errors for all tickers.
 */
export class IBPriceFetcher implements PriceFetcher {
  constructor(
    private readonly client: Pick<IBApiClient, 'fetchMarketData'>,
    private readonly store: IBSessionStore,
  ) {}

  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    if (!this.store.isAuthenticated()) {
      return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'no_session' }));
    }

    // Only fetch conids we know about — others get not_found immediately
    const validConids: number[] = [];
    const conidToTicker = new Map<number, string>();

    for (const ticker of tickers) {
      const conid = parseInt(ticker, 10);
      if (!isNaN(conid) && String(conid) === ticker) {
        validConids.push(conid);
        conidToTicker.set(conid, ticker);
      }
    }

    // Tickers that aren't numeric conids can't be handled — return not_found
    const invalidTickers = tickers.filter(
      (t) => !validConids.map(String).includes(t),
    );

    if (validConids.length === 0) {
      return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'not_found' }));
    }

    try {
      const snapshots = await this.client.fetchMarketData(validConids);
      const snapshotMap = new Map(snapshots.map((s) => [s.conid, s]));

      const results: PriceResult[] = [];

      for (const conid of validConids) {
        const ticker = conidToTicker.get(conid) ?? String(conid);
        const snapshot = snapshotMap.get(conid);
        const lastPriceStr = snapshot?.['31'];

        if (!lastPriceStr) {
          results.push({ ticker, status: 'error', error: 'not_found' });
          continue;
        }

        const price = parseFloat(lastPriceStr);
        if (isNaN(price)) {
          results.push({ ticker, status: 'error', error: 'not_found' });
          continue;
        }

        results.push({
          ticker,
          status: 'success',
          price,
          currency: 'USD', // IB gateway doesn't return currency in snapshot fields 31/84/86
        });
      }

      // Append not_found for any non-conid tickers
      for (const ticker of invalidTickers) {
        results.push({ ticker, status: 'error', error: 'not_found' });
      }

      return results;
    } catch {
      this.store.clearSession();
      return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'session_expired' }));
    }
  }
}
