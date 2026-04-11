import { describe, it, expect, vi } from 'vitest';
import type { PsagotAuthorizedSession, PsagotMarketRate } from '../../../../../packages/domain/src/types/psagotApi';
import { PsagotPriceFetcher } from '../PsagotPriceFetcher';
import { PsagotSessionStore } from '../PsagotSessionStore';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SESSION: PsagotAuthorizedSession = {
  sessionKey: 'sk-123',
  csession: 'cs-456',
  status: 'authorized',
  authorizedAt: Date.now(),
};

const EXCHANGE_DATE = '2026-04-10T15:25:00.000+03:00';

function makeRate(equityNumber: string, baseRate: number, overrides: Partial<PsagotMarketRate> = {}): PsagotMarketRate {
  return {
    equityNumber,
    baseRate,
    currencyCode: 'ILS',
    currencyDivider: 1,
    lastKnownRateDate: EXCHANGE_DATE,
    ...overrides,
  };
}

function makeMockClient(rates: PsagotMarketRate[] = []) {
  return {
    fetchMarketRates: vi.fn().mockResolvedValue(rates),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PsagotPriceFetcher', () => {
  it('returns all errors when no session is active', async () => {
    const store = new PsagotSessionStore();
    const client = makeMockClient();
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441', '5112628']);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'error', error: 'no_session' });
    expect(results[1]).toMatchObject({ ticker: '5112628', status: 'error', error: 'no_session' });
    expect(client.fetchMarketRates).not.toHaveBeenCalled();
  });

  it('returns empty array for empty tickers input', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient();
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices([]);

    expect(results).toHaveLength(0);
    expect(client.fetchMarketRates).not.toHaveBeenCalled();
  });

  it('calls fetchMarketRates (not fetchBalances) with all tickers in one request', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([makeRate('1183441', 5000)]);
    const fetcher = new PsagotPriceFetcher(client as never, store);

    await fetcher.fetchPrices(['1183441']);

    expect(client.fetchMarketRates).toHaveBeenCalledWith(SESSION, ['1183441']);
  });

  it('returns live price for a known equity number', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([makeRate('1183441', 1734)]);
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'success', price: 1734, currency: 'ILS' });
  });

  it('applies currencyDivider (agorot → ILS)', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([makeRate('1183441', 17340, { currencyDivider: 100 })]);
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'success', price: 173.4 });
  });

  it('sets fetchedAt from lastKnownRateDate (exchange timestamp, not call time)', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([makeRate('1183441', 5000, { lastKnownRateDate: EXCHANGE_DATE })]);
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ status: 'success', fetchedAt: EXCHANGE_DATE });
  });

  it('handles multiple tickers in a single call', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([
      makeRate('1183441', 5000, { currencyDivider: 100 }),
      makeRate('75416503', 510.25, { currencyCode: 'USD', currencyDivider: 1 }),
    ]);
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441', '75416503']);

    expect(results.find((r) => r.ticker === '1183441')).toMatchObject({ status: 'success', price: 50 });
    expect(results.find((r) => r.ticker === '75416503')).toMatchObject({ status: 'success', price: 510.25, currency: 'USD' });
  });

  it('returns error for tickers not in the API response', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([makeRate('1183441', 5000)]);
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441', '9999999']);

    expect(results.find((r) => r.ticker === '9999999')).toMatchObject({ status: 'error', error: 'not_found' });
  });

  it('returns error for zero or negative baseRate', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([makeRate('1183441', 0)]);
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'error', error: 'not_found' });
  });

  it('clears session and returns errors on API failure', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = { fetchMarketRates: vi.fn().mockRejectedValue(new Error('session expired')) };
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'error', error: 'session_expired' });
    expect(store.getSession()).toBeNull();
  });
});
