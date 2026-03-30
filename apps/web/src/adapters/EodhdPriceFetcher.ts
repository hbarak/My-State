import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';

/**
 * Browser-side PriceFetcher adapter for the EODHD price backend.
 *
 * Calls the Vite dev server plugin at /api/prices which proxies to EODHD.
 * Numeric TASE fund IDs are handled by FanOutPriceFetcher before reaching this adapter.
 */
export class EodhdPriceFetcher implements PriceFetcher {
  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    const response = await fetch('/api/prices', {
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
