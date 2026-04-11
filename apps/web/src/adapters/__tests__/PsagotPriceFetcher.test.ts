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

function makeMockClient(rates: PsagotMarketRate[] = [], equityBySymbol: Record<string, string> = {}) {
  return {
    fetchMarketRates: vi.fn().mockResolvedValue(rates),
    resolveTickerToEquityNumber: vi.fn().mockImplementation((_session: unknown, symbol: string) =>
      Promise.resolve(equityBySymbol[symbol.toUpperCase()] ?? null),
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — equity number tickers (all-digit)
// ─────────────────────────────────────────────────────────────────────────────

describe('PsagotPriceFetcher — equity number tickers', () => {
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

  it('calls fetchMarketRates with equity number directly (no resolution needed)', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([makeRate('1183441', 5000)]);
    const fetcher = new PsagotPriceFetcher(client as never, store);

    await fetcher.fetchPrices(['1183441']);

    expect(client.fetchMarketRates).toHaveBeenCalledWith(SESSION, ['1183441']);
    expect(client.resolveTickerToEquityNumber).not.toHaveBeenCalled();
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
    const client = { fetchMarketRates: vi.fn().mockRejectedValue(new Error('session expired')), resolveTickerToEquityNumber: vi.fn() };
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'error', error: 'session_expired' });
    expect(store.getSession()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — symbol tickers (via autoComplete resolution)
// ─────────────────────────────────────────────────────────────────────────────

describe('PsagotPriceFetcher — symbol ticker resolution', () => {
  it('resolves a symbol ticker to equity number and fetches price', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient(
      [makeRate('72703929', 54.45, { currencyCode: 'USD', currencyDivider: 1 })],
      { LMND: '72703929' },
    );
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['LMND']);

    expect(client.resolveTickerToEquityNumber).toHaveBeenCalledWith(SESSION, 'LMND');
    expect(client.fetchMarketRates).toHaveBeenCalledWith(SESSION, ['72703929']);
    expect(results[0]).toMatchObject({ ticker: 'LMND', status: 'success', price: 54.45, currency: 'USD' });
  });

  it('returns not_found for symbol that cannot be resolved', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient([], {}); // resolveTickerToEquityNumber returns null
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['UNKNOWN']);

    expect(results[0]).toMatchObject({ ticker: 'UNKNOWN', status: 'error', error: 'not_found' });
  });

  it('caches resolved equity numbers and skips resolution on subsequent calls', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient(
      [makeRate('72703929', 54.45, { currencyCode: 'USD' })],
      { LMND: '72703929' },
    );
    const fetcher = new PsagotPriceFetcher(client as never, store);

    await fetcher.fetchPrices(['LMND']);
    await fetcher.fetchPrices(['LMND']);

    // resolveTickerToEquityNumber should only be called once (second call uses cache)
    expect(client.resolveTickerToEquityNumber).toHaveBeenCalledTimes(1);
  });

  it('handles mixed equity numbers and symbol tickers in one call', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient(
      [
        makeRate('1183441', 17340, { currencyDivider: 100 }),
        makeRate('72703929', 54.45, { currencyCode: 'USD' }),
      ],
      { LMND: '72703929' },
    );
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441', 'LMND']);

    expect(results.find((r) => r.ticker === '1183441')).toMatchObject({ status: 'success', price: 173.4 });
    expect(results.find((r) => r.ticker === 'LMND')).toMatchObject({ status: 'success', price: 54.45, currency: 'USD' });
  });

  it('resolves multiple symbols in parallel', async () => {
    const store = new PsagotSessionStore();
    store.setSession(SESSION);
    const client = makeMockClient(
      [
        makeRate('72703929', 54.45, { currencyCode: 'USD' }),
        makeRate('75416503', 510.25, { currencyCode: 'USD' }),
      ],
      { LMND: '72703929', SPY: '75416503' },
    );
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['LMND', 'SPY']);

    expect(client.resolveTickerToEquityNumber).toHaveBeenCalledTimes(2);
    expect(results.find((r) => r.ticker === 'LMND')).toMatchObject({ status: 'success', price: 54.45 });
    expect(results.find((r) => r.ticker === 'SPY')).toMatchObject({ status: 'success', price: 510.25 });
  });
});
