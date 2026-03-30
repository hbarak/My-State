import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';

/**
 * Browser-side PriceFetcher adapter for TASE mutual fund prices.
 *
 * Calls /api/prices-maya on the Vite dev server, which proxies to the Maya
 * TASE API (mayaapi.tase.co.il) server-side — bypassing browser CORS restrictions.
 *
 * Only handles all-digit TASE numeric fund IDs (e.g. "1183441").
 * Use inside FanOutPriceFetcher which routes these IDs here and exchange
 * tickers to EodhdPriceFetcher.
 *
 * Production note (R5.5): replace /api/prices-maya with a Supabase Edge Function
 * or serverless endpoint at the same time as /api/prices is migrated.
 */
export class MayaPriceFetcher implements PriceFetcher {
  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    const response = await fetch('/api/prices-maya', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers }),
    });

    if (!response.ok) {
      return tickers.map((ticker) => ({
        ticker,
        status: 'error' as const,
        error: `HTTP ${response.status}`,
      }));
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      return tickers.map((ticker) => ({
        ticker,
        status: 'error' as const,
        error: 'Invalid response format',
      }));
    }

    return tickers.map((ticker) => {
      const match = (body as unknown[]).find(
        (item): item is PriceResult =>
          typeof item === 'object' &&
          item !== null &&
          'ticker' in item &&
          (item as Record<string, unknown>).ticker === ticker &&
          'status' in item &&
          ((item as Record<string, unknown>).status === 'success' ||
            (item as Record<string, unknown>).status === 'error'),
      );
      return match ?? { ticker, status: 'error' as const, error: 'Malformed response' };
    });
  }
}
