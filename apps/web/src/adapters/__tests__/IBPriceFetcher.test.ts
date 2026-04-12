import { describe, it, expect, beforeEach } from 'vitest';
import type { IBApiClient } from '@my-stocks/infra';
import type { IBMarketDataSnapshot } from '@my-stocks/domain';
import { IBPriceFetcher } from '../IBPriceFetcher';
import { IBSessionStore } from '../IBSessionStore';

function stubClient(snapshots: IBMarketDataSnapshot[]): Pick<IBApiClient, 'fetchMarketData'> & { calls: number[][] } {
  const calls: number[][] = [];
  return {
    calls,
    async fetchMarketData(conids: readonly number[]) {
      calls.push([...conids]);
      return snapshots.filter((s) => conids.includes(s.conid));
    },
  };
}

describe('IBPriceFetcher', () => {
  let store: IBSessionStore;

  beforeEach(() => {
    store = new IBSessionStore();
    store.setAuthenticated(true);
    store.setConidMaps(
      new Map([['265598', 'AAPL'], ['756733', 'MSFT']]),
      new Map([['265598', 'AAPL (NASDAQ)'], ['756733', 'MSFT (NASDAQ)']]),
    );
  });

  it('returns error for all tickers when not authenticated', async () => {
    store.setAuthenticated(false);
    const client = stubClient([]);
    const fetcher = new IBPriceFetcher(client as unknown as IBApiClient, store);

    const results = await fetcher.fetchPrices(['265598', '756733']);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ticker: '265598', status: 'error', error: 'no_session' });
    expect(results[1]).toMatchObject({ ticker: '756733', status: 'error', error: 'no_session' });
  });

  it('returns empty array for empty input', async () => {
    const client = stubClient([]);
    const fetcher = new IBPriceFetcher(client as unknown as IBApiClient, store);

    const results = await fetcher.fetchPrices([]);
    expect(results).toEqual([]);
  });

  it('fetches prices for known conids and returns success results', async () => {
    const client = stubClient([
      { conid: 265598, '31': '182.50', '55': 'AAPL' },
      { conid: 756733, '31': '420.00', '55': 'MSFT' },
    ]);
    const fetcher = new IBPriceFetcher(client as unknown as IBApiClient, store);

    const results = await fetcher.fetchPrices(['265598', '756733']);

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.ticker === '265598')).toMatchObject({
      status: 'success',
      price: 182.50,
      currency: 'USD',
    });
    expect(results.find((r) => r.ticker === '756733')).toMatchObject({
      status: 'success',
      price: 420.00,
    });
  });

  it('returns error for tickers not in snapshot response', async () => {
    const client = stubClient([
      { conid: 265598, '31': '182.50' },
      // 756733 missing from response
    ]);
    const fetcher = new IBPriceFetcher(client as unknown as IBApiClient, store);

    const results = await fetcher.fetchPrices(['265598', '756733']);

    expect(results.find((r) => r.ticker === '265598')).toMatchObject({ status: 'success' });
    expect(results.find((r) => r.ticker === '756733')).toMatchObject({ status: 'error', error: 'not_found' });
  });

  it('returns error for tickers with no last price in snapshot (field 31 missing)', async () => {
    const client = stubClient([
      { conid: 265598 }, // no '31' field
    ]);
    const fetcher = new IBPriceFetcher(client as unknown as IBApiClient, store);

    const results = await fetcher.fetchPrices(['265598']);

    expect(results[0]).toMatchObject({ ticker: '265598', status: 'error', error: 'not_found' });
  });

  it('clears session and returns errors on API exception', async () => {
    const failClient = {
      async fetchMarketData() { throw new Error('session expired'); },
    };
    const fetcher = new IBPriceFetcher(failClient as unknown as IBApiClient, store);

    const results = await fetcher.fetchPrices(['265598']);

    expect(results[0]).toMatchObject({ ticker: '265598', status: 'error', error: 'session_expired' });
    expect(store.isAuthenticated()).toBe(false);
  });

  it('converts conid numeric strings to numbers for the API call', async () => {
    const client = stubClient([{ conid: 265598, '31': '182.50' }]);
    const fetcher = new IBPriceFetcher(client as unknown as IBApiClient, store);

    await fetcher.fetchPrices(['265598']);

    expect(client.calls[0]).toContain(265598); // number, not string
  });

  it('skips tickers that are not known conids', async () => {
    const client = stubClient([]);
    const fetcher = new IBPriceFetcher(client as unknown as IBApiClient, store);

    // 'UNKNOWN' is not a numeric conid in the store
    const results = await fetcher.fetchPrices(['UNKNOWN']);

    expect(results[0]).toMatchObject({ ticker: 'UNKNOWN', status: 'error', error: 'not_found' });
    expect(client.calls).toHaveLength(0); // no API call for non-conid ticker
  });
});
