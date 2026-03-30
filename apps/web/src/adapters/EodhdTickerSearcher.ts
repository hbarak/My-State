import type { TickerSearcher } from '../../../../packages/domain/src/ports/TickerSearcher';

/**
 * Browser-side TickerSearcher adapter for the EODHD ticker search backend.
 *
 * Calls the Vite dev server plugin at /api/ticker-search which proxies to EODHD.
 */
export class EodhdTickerSearcher implements TickerSearcher {
  async searchTicker(securityName: string): Promise<string | null> {
    const response = await fetch('/api/ticker-search', {
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
