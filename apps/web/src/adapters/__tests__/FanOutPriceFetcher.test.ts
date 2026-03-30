import { describe, it, expect, vi } from 'vitest';
import type { PriceFetcher, PriceResult } from '../../../../../packages/domain/src/services/MarketPriceService';
import { FanOutPriceFetcher, isTaseNumericId } from '../FanOutPriceFetcher';

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

describe('FanOutPriceFetcher', () => {
  it('routes all non-numeric tickers to EODHD fetcher only', async () => {
    const eodhd = stubFetcher([
      { ticker: 'DLEKG.TA', status: 'success', price: 1234, currency: 'ILS' },
      { ticker: 'AAPL', status: 'success', price: 200, currency: 'USD' },
    ]);
    const maya = stubFetcher([]);
    const fanOut = new FanOutPriceFetcher(eodhd, maya);

    const results = await fanOut.fetchPrices(['DLEKG.TA', 'AAPL']);

    expect(eodhd.calls).toHaveLength(1);
    expect(eodhd.calls[0]).toEqual(['DLEKG.TA', 'AAPL']);
    expect(maya.calls).toHaveLength(0);
    expect(results).toHaveLength(2);
  });

  it('routes all numeric tickers to Maya fetcher only', async () => {
    const eodhd = stubFetcher([]);
    const maya = stubFetcher([
      { ticker: '1183441', status: 'success', price: 17.34, currency: 'ILS' },
    ]);
    const fanOut = new FanOutPriceFetcher(eodhd, maya);

    const results = await fanOut.fetchPrices(['1183441']);

    expect(maya.calls).toHaveLength(1);
    expect(maya.calls[0]).toEqual(['1183441']);
    expect(eodhd.calls).toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'success' });
  });

  it('routes mixed tickers to both fetchers and merges results', async () => {
    const eodhd = stubFetcher([
      { ticker: 'DLEKG.TA', status: 'success', price: 1234, currency: 'ILS' },
    ]);
    const maya = stubFetcher([
      { ticker: '1183441', status: 'success', price: 17.34, currency: 'ILS' },
      { ticker: '5112628', status: 'success', price: 9.5, currency: 'ILS' },
    ]);
    const fanOut = new FanOutPriceFetcher(eodhd, maya);

    const results = await fanOut.fetchPrices(['DLEKG.TA', '1183441', '5112628']);

    expect(eodhd.calls[0]).toEqual(['DLEKG.TA']);
    expect(maya.calls[0]).toContain('1183441');
    expect(maya.calls[0]).toContain('5112628');
    expect(results).toHaveLength(3);
  });

  it('calls both fetchers in parallel (not sequentially)', async () => {
    const order: string[] = [];
    const eodhd: PriceFetcher = {
      async fetchPrices() {
        await new Promise((r) => setTimeout(r, 10));
        order.push('eodhd');
        return [{ ticker: 'AAPL', status: 'success', price: 200, currency: 'USD' }];
      },
    };
    const maya: PriceFetcher = {
      async fetchPrices() {
        order.push('maya');
        return [{ ticker: '1183441', status: 'success', price: 17, currency: 'ILS' }];
      },
    };
    const fanOut = new FanOutPriceFetcher(eodhd, maya);

    await fanOut.fetchPrices(['AAPL', '1183441']);

    // Maya resolves before EODHD (no delay) — both were started together
    expect(order).toEqual(['maya', 'eodhd']);
  });

  it('returns empty array for empty input without calling either fetcher', async () => {
    const eodhd = stubFetcher([]);
    const maya = stubFetcher([]);
    const fanOut = new FanOutPriceFetcher(eodhd, maya);

    const results = await fanOut.fetchPrices([]);

    expect(results).toHaveLength(0);
    expect(eodhd.calls).toHaveLength(0);
    expect(maya.calls).toHaveLength(0);
  });
});
