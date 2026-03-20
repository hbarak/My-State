import type { TickerSearcher } from '../../../../packages/domain/src/ports/TickerSearcher';

/**
 * Browser-side TickerSearcher adapter.
 *
 * Like the PriceFetcher, yahoo-finance2 is Node-only.
 * This adapter calls a local dev proxy endpoint.
 *
 * TODO(R3): replace with backend API endpoint.
 */
export class YahooFinanceTickerSearcher implements TickerSearcher {
  async searchTicker(securityName: string): Promise<string | null> {
    const url = '/api/ticker-search';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: securityName }),
    });

    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'ticker' in body && typeof (body as { ticker: unknown }).ticker === 'string') {
      return (body as { ticker: string }).ticker;
    }

    return null;
  }
}
