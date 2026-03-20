import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';

/**
 * Browser-side PriceFetcher adapter.
 *
 * yahoo-finance2 is a Node-only library (uses https module).  In the browser we
 * cannot call it directly.  For R2 we use a thin local proxy/stub.
 *
 * TODO(R3): replace with a backend API endpoint or serverless function that
 * calls yahoo-finance2 and returns PriceResult[].
 */
export class YahooFinancePriceFetcher implements PriceFetcher {
  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    // For R2, attempt to call a local dev proxy at /api/prices.
    // If the proxy is not running the fetch fails and the enricher
    // falls back to cost-basis-only display (graceful degradation).
    const url = '/api/prices';
    const response = await fetch(url, {
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
