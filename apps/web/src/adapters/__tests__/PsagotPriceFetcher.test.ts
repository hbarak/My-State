import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PsagotAuthorizedSession, PsagotBalance, PsagotSecurityInfo } from '../../../../../packages/domain/src/types/psagotApi';
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

function makeBalance(equityNumber: string, lastRate: number, currencyCode = 'ILS'): PsagotBalance {
  return {
    equityNumber,
    quantity: 100,
    lastRate,
    averagePrice: 50,
    marketValue: lastRate * 100,
    marketValueNis: lastRate * 100,
    profitLoss: 0,
    profitLossNis: 0,
    profitLossPct: 0,
    portfolioWeight: 10,
    currencyCode,
    source: 'test',
    subAccount: '',
    hebName: null,
  };
}

function makeSecurityInfo(equityNumber: string, divider = 1): PsagotSecurityInfo {
  return {
    equityNumber,
    hebName: `Security ${equityNumber}`,
    engName: null,
    engSymbol: null,
    exchange: 'TASE',
    currencyCode: 'ILS',
    currencyDivider: divider,
    isForeign: false,
    itemType: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock PsagotApiClient
// ─────────────────────────────────────────────────────────────────────────────

function makeMockClient(balancesByAccount: Record<string, PsagotBalance[]> = {}) {
  return {
    fetchBalances: vi.fn(async (_session: PsagotAuthorizedSession, accountKey: string) => {
      return balancesByAccount[accountKey] ?? [];
    }),
    // Other methods we don't need
    initiateLogin: vi.fn(),
    verifyOtp: vi.fn(),
    fetchAccounts: vi.fn(),
    fetchSecurityInfo: vi.fn(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('PsagotPriceFetcher', () => {
  let store: PsagotSessionStore;

  beforeEach(() => {
    store = new PsagotSessionStore();
  });

  it('returns all errors when no session is active', async () => {
    const client = makeMockClient();
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441', '5112628']);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'error', error: 'no_session' });
    expect(results[1]).toMatchObject({ ticker: '5112628', status: 'error', error: 'no_session' });
    expect(client.fetchBalances).not.toHaveBeenCalled();
  });

  it('returns prices for known equity numbers from single account', async () => {
    store.setSession(SESSION);
    store.setAccountKeys(['ACC-1']);
    store.setSecurityInfoMap(new Map([
      ['1183441', makeSecurityInfo('1183441')],
    ]));

    const client = makeMockClient({
      'ACC-1': [makeBalance('1183441', 1734)],
    });
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ticker: '1183441',
      status: 'success',
      price: 1734,
      currency: 'ILS',
    });
  });

  it('applies currency divider (agorot → ILS)', async () => {
    store.setSession(SESSION);
    store.setAccountKeys(['ACC-1']);
    store.setSecurityInfoMap(new Map([
      ['1183441', makeSecurityInfo('1183441', 100)],
    ]));

    const client = makeMockClient({
      'ACC-1': [makeBalance('1183441', 17340)], // 17340 agorot = 173.40 ILS
    });
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({
      ticker: '1183441',
      status: 'success',
      price: 173.4,
      currency: 'ILS',
    });
  });

  it('returns prices from multiple accounts', async () => {
    store.setSession(SESSION);
    store.setAccountKeys(['ACC-1', 'ACC-2']);
    store.setSecurityInfoMap(new Map([
      ['1183441', makeSecurityInfo('1183441')],
      ['5112628', makeSecurityInfo('5112628')],
    ]));

    const client = makeMockClient({
      'ACC-1': [makeBalance('1183441', 100)],
      'ACC-2': [makeBalance('5112628', 200)],
    });
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441', '5112628']);

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.ticker === '1183441')).toMatchObject({ status: 'success', price: 100 });
    expect(results.find((r) => r.ticker === '5112628')).toMatchObject({ status: 'success', price: 200 });
  });

  it('uses latest price when same equity appears in multiple accounts', async () => {
    store.setSession(SESSION);
    store.setAccountKeys(['ACC-1', 'ACC-2']);
    store.setSecurityInfoMap(new Map([
      ['1183441', makeSecurityInfo('1183441')],
    ]));

    const client = makeMockClient({
      'ACC-1': [makeBalance('1183441', 100)],
      'ACC-2': [makeBalance('1183441', 105)], // Processed later → takes precedence
    });
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ price: 105 });
  });

  it('returns error for tickers not found in any account balance', async () => {
    store.setSession(SESSION);
    store.setAccountKeys(['ACC-1']);
    store.setSecurityInfoMap(new Map());

    const client = makeMockClient({
      'ACC-1': [makeBalance('1183441', 100)],
    });
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['9999999']);

    expect(results[0]).toMatchObject({ ticker: '9999999', status: 'error', error: 'not_found' });
  });

  it('clears session and returns errors on API failure', async () => {
    store.setSession(SESSION);
    store.setAccountKeys(['ACC-1']);
    store.setSecurityInfoMap(new Map());

    const client = makeMockClient();
    client.fetchBalances.mockRejectedValue(new Error('Session expired'));
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'error' });
    expect(store.getSession()).toBeNull();
  });

  it('returns empty array for empty tickers input', async () => {
    store.setSession(SESSION);
    const client = makeMockClient();
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices([]);

    expect(results).toHaveLength(0);
    expect(client.fetchBalances).not.toHaveBeenCalled();
  });

  it('returns errors when no account keys are cached', async () => {
    store.setSession(SESSION);
    // accountKeys left as empty default
    store.setSecurityInfoMap(new Map());

    const client = makeMockClient();
    const fetcher = new PsagotPriceFetcher(client as never, store);

    const results = await fetcher.fetchPrices(['1183441']);

    expect(results[0]).toMatchObject({ ticker: '1183441', status: 'error', error: 'not_found' });
    expect(client.fetchBalances).not.toHaveBeenCalled();
  });
});
