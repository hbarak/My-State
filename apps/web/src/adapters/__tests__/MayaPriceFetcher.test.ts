import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MayaPriceFetcher } from '../MayaPriceFetcher';

/**
 * MayaPriceFetcher is now a thin browser adapter that calls /api/prices-maya.
 * extractNav and Maya API logic live in price-plugin.ts (server-side).
 * These tests mock globalThis.fetch to simulate the /api/prices-maya endpoint.
 */

function mockFetch(responses: Array<{ ok: boolean; status?: number; body?: unknown; throws?: Error }>) {
  let callIndex = 0;
  return vi.fn(async (_url: string) => {
    const resp = responses[callIndex++] ?? { ok: false, status: 500 };
    if (resp.throws) throw resp.throws;
    return {
      ok: resp.ok,
      status: resp.status ?? (resp.ok ? 200 : 500),
      json: async () => resp.body,
    };
  });
}

describe('MayaPriceFetcher', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls /api/prices-maya with tickers and returns success results', async () => {
    const fetchMock = mockFetch([{
      ok: true,
      body: [
        { ticker: '1183441', status: 'success', price: 17.34, currency: 'ILS' },
      ],
    }]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const fetcher = new MayaPriceFetcher();
    const results = await fetcher.fetchPrices(['1183441']);

    expect(fetchMock).toHaveBeenCalledWith('/api/prices-maya', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ tickers: ['1183441'] }),
    }));
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ ticker: '1183441', status: 'success', price: 17.34, currency: 'ILS' });
  });

  it('returns per-ticker errors when /api/prices-maya returns HTTP error', async () => {
    globalThis.fetch = mockFetch([{ ok: false, status: 502 }]) as unknown as typeof fetch;

    const fetcher = new MayaPriceFetcher();
    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('502');
  });

  it('returns per-ticker errors when response body is not an array', async () => {
    globalThis.fetch = mockFetch([{ ok: true, body: { error: 'bad' } }]) as unknown as typeof fetch;

    const fetcher = new MayaPriceFetcher();
    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('Invalid response format');
  });

  it('handles multiple fund IDs in a single call', async () => {
    const fetchMock = mockFetch([{
      ok: true,
      body: [
        { ticker: '1183441', status: 'success', price: 17.34, currency: 'ILS' },
        { ticker: '5112628', status: 'success', price: 9.5, currency: 'ILS' },
      ],
    }]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const fetcher = new MayaPriceFetcher();
    const results = await fetcher.fetchPrices(['1183441', '5112628']);

    // Single call to the proxy endpoint (not one per fund)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0].ticker).toBe('1183441');
    expect(results[1].ticker).toBe('5112628');
  });

  it('returns empty array for empty input without calling fetch', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const fetcher = new MayaPriceFetcher();
    const results = await fetcher.fetchPrices([]);

    expect(results).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
