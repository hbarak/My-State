import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';

/** Thrown when the EODHD daily quota (HTTP 402) is exceeded. */
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Browser-side PriceFetcher adapter for the EODHD price backend.
 *
 * Calls the Vite dev server plugin at /api/prices which proxies to EODHD.
 * Numeric TASE fund IDs are handled by FanOutPriceFetcher before reaching this adapter.
 *
 * Throws QuotaExceededError when the BFF returns { error: 'quota_exceeded' }.
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
      // Attempt to read the structured error body before falling back to generic HTTP error
      try {
        const errBody = await response.json() as unknown;
        if (
          typeof errBody === 'object' &&
          errBody !== null &&
          (errBody as Record<string, unknown>).error === 'quota_exceeded'
        ) {
          const msg = (errBody as Record<string, unknown>).message;
          throw new QuotaExceededError(
            typeof msg === 'string' ? msg : 'Daily price limit reached. Prices will refresh tomorrow.',
          );
        }
      } catch (e) {
        if (e instanceof QuotaExceededError) throw e;
        // JSON parse failed — fall through to generic error mapping
      }
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
