import { describe, it, expect } from 'vitest';
import type { PriceFetcher, PriceResult } from '../../../../../packages/domain/src/services/MarketPriceService';
import { FanOutPriceFetcher, isTaseNumericId, type PriceFetcherRoute } from '../FanOutPriceFetcher';

function stubFetcher(results: PriceResult[]): PriceFetcher & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
      calls.push([...tickers]);
      return results.filter((r) => tickers.includes(r.ticker));
    },
  };
}

function makeRoutes(
  maya: PriceFetcher,
  provider?: PriceFetcher,
): PriceFetcherRoute[] {
  const routes: PriceFetcherRoute[] = [
    {
      name: 'maya',
      canHandle: isTaseNumericId,
      fetcher: maya,
      exclusive: true,
    },
  ];
  if (provider) {
    routes.unshift(
      {
        name: 'provider-equity',
        canHandle: () => false, // relies on updateKnownTickers
        fetcher: provider,
        exclusive: true,
      },
      {
        name: 'provider-symbol',
        canHandle: (t) => !isTaseNumericId(t),
        fetcher: provider,
        exclusive: false,
      },
    );
  }
  return routes;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('isTaseNumericId', () => {
  it('returns true for all-digit strings', () => {
    expect(isTaseNumericId('1183441')).toBe(true);
    expect(isTaseNumericId('5112628')).toBe(true);
    expect(isTaseNumericId('0')).toBe(true);
  });

  it('returns false for tickers with letters or dots', () => {
    expect(isTaseNumericId('DLEKG.TA')).toBe(false);
    expect(isTaseNumericId('AAPL')).toBe(false);
    expect(isTaseNumericId('LUMI.TA')).toBe(false);
    expect(isTaseNumericId('1234abc')).toBe(false);
    expect(isTaseNumericId('123.45')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTaseNumericId('')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('FanOutPriceFetcher — two-source mode (no provider)', () => {
  it('routes all non-numeric tickers to fallback (EODHD)', async () => {
    const eodhd = stubFetcher([
      { ticker: 'DLEKG.TA', status: 'success', price: 1234, currency: 'ILS' },
      { ticker: 'AAPL', status: 'success', price: 200, currency: 'USD' },
    ]);
    const maya = stubFetcher([]);
    const fanOut = new FanOutPriceFetcher(makeRoutes(maya), eodhd);

    const results = await fanOut.fetchPrices(['DLEKG.TA', 'AAPL']);

    expect(eodhd.calls).toHaveLength(1);
    expect(eodhd.calls[0]).toEqual(expect.arrayContaining(['DLEKG.TA', 'AAPL']));
    expect(maya.calls).toHaveLength(0);
    expect(results).toHaveLength(2);
  });

  it('routes all-digit tickers to Maya via exclusive route', async () => {
    const eodhd = stubFetcher([]);
    const maya = stubFetcher([
      { ticker: '1183441', status: 'success', price: 17.34, currency: 'ILS' },
    ]);
    const fanOut = new FanOutPriceFetcher(makeRoutes(maya), eodhd);

    const results = await fanOut.fetchPrices(['1183441']);

    expect(maya.calls).toHaveLength(1);
    expect(maya.calls[0]).toEqual(['1183441']);
    expect(eodhd.calls).toHaveLength(0);
    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'success' });
  });

  it('routes mixed tickers to both fetchers and merges results', async () => {
    const eodhd = stubFetcher([
      { ticker: 'DLEKG.TA', status: 'success', price: 1234, currency: 'ILS' },
    ]);
    const maya = stubFetcher([
      { ticker: '1183441', status: 'success', price: 17.34, currency: 'ILS' },
    ]);
    const fanOut = new FanOutPriceFetcher(makeRoutes(maya), eodhd);

    const results = await fanOut.fetchPrices(['DLEKG.TA', '1183441']);

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.ticker === 'DLEKG.TA')).toMatchObject({ status: 'success' });
    expect(results.find((r) => r.ticker === '1183441')).toMatchObject({ status: 'success' });
  });

  it('returns empty array for empty input', async () => {
    const fanOut = new FanOutPriceFetcher(makeRoutes(stubFetcher([])), stubFetcher([]));
    expect(await fanOut.fetchPrices([])).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('FanOutPriceFetcher — with provider routes', () => {
  it('routes known equity numbers exclusively to provider via updateKnownTickers', async () => {
    const eodhd = stubFetcher([
      { ticker: 'AAPL', status: 'success', price: 200, currency: 'USD' },
    ]);
    const maya = stubFetcher([]);
    const provider = stubFetcher([
      { ticker: '1183441', status: 'success', price: 100, currency: 'ILS' },
    ]);
    const fanOut = new FanOutPriceFetcher(makeRoutes(maya, provider), eodhd);
    fanOut.updateKnownTickers('provider-equity', new Set(['1183441']));

    const results = await fanOut.fetchPrices(['1183441', 'AAPL']);

    expect(results.find((r) => r.ticker === '1183441')).toMatchObject({ status: 'success', price: 100 });
    expect(results.find((r) => r.ticker === 'AAPL')).toMatchObject({ status: 'success', price: 200 });
  });

  it('falls back to EODHD when exclusive provider route errors', async () => {
    const eodhd = stubFetcher([
      { ticker: '1183441', status: 'success', price: 50, currency: 'ILS' },
    ]);
    const maya = stubFetcher([]);
    const provider = stubFetcher([
      { ticker: '1183441', status: 'error', error: 'session_expired' },
    ]);
    const fanOut = new FanOutPriceFetcher(makeRoutes(maya, provider), eodhd);
    fanOut.updateKnownTickers('provider-equity', new Set(['1183441']));

    const results = await fanOut.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ status: 'success', price: 50 });
  });

  it('sends symbol tickers to both provider (non-exclusive) and EODHD in parallel; provider wins', async () => {
    const eodhd = stubFetcher([
      { ticker: 'LMND', status: 'success', price: 40, currency: 'USD' },
    ]);
    const maya = stubFetcher([]);
    const provider = stubFetcher([
      { ticker: 'LMND', status: 'success', price: 54.45, currency: 'USD' },
    ]);
    const fanOut = new FanOutPriceFetcher(makeRoutes(maya, provider), eodhd);

    const results = await fanOut.fetchPrices(['LMND']);

    // Provider result wins
    expect(results[0]).toMatchObject({ ticker: 'LMND', status: 'success', price: 54.45 });
  });

  it('falls back to EODHD when provider returns error for symbol ticker', async () => {
    const eodhd = stubFetcher([
      { ticker: 'LMND', status: 'success', price: 40, currency: 'USD' },
    ]);
    const maya = stubFetcher([]);
    const provider = stubFetcher([
      { ticker: 'LMND', status: 'error', error: 'not_found' },
    ]);
    const fanOut = new FanOutPriceFetcher(makeRoutes(maya, provider), eodhd);

    const results = await fanOut.fetchPrices(['LMND']);

    expect(results[0]).toMatchObject({ ticker: 'LMND', status: 'success', price: 40 });
  });

  it('mixes equity numbers, TASE funds, and symbol tickers correctly', async () => {
    const eodhd = stubFetcher([
      { ticker: 'AAPL', status: 'success', price: 200, currency: 'USD' },
    ]);
    const maya = stubFetcher([
      { ticker: '9999999', status: 'success', price: 10, currency: 'ILS' },
    ]);
    const provider = stubFetcher([
      { ticker: '1183441', status: 'success', price: 100, currency: 'ILS' },
      { ticker: 'AAPL', status: 'success', price: 205, currency: 'USD' },
    ]);
    const fanOut = new FanOutPriceFetcher(makeRoutes(maya, provider), eodhd);
    fanOut.updateKnownTickers('provider-equity', new Set(['1183441']));

    const results = await fanOut.fetchPrices(['AAPL', '1183441', '9999999']);

    expect(results.find((r) => r.ticker === '1183441')).toMatchObject({ status: 'success', price: 100 });
    expect(results.find((r) => r.ticker === '9999999')).toMatchObject({ status: 'success', price: 10 });
    // AAPL: provider (non-exclusive) wins at 205 over EODHD 200
    expect(results.find((r) => r.ticker === 'AAPL')).toMatchObject({ status: 'success', price: 205 });
  });
});
