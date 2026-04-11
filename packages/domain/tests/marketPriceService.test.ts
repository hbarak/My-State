import { describe, expect, it } from 'vitest';
import { MarketPriceService } from '../src/services/MarketPriceService';
import type { PriceFetcher, PriceRequest, PriceResult } from '../src/services/MarketPriceService';

function stubFetcher(results: PriceResult[]): PriceFetcher {
  return {
    async fetchPrices(_tickers: readonly string[]): Promise<readonly PriceResult[]> {
      return results;
    },
  };
}

function throwingFetcher(error: Error): PriceFetcher {
  return {
    async fetchPrices(): Promise<readonly PriceResult[]> {
      throw error;
    },
  };
}

function successResult(ticker: string, price: number, currency = 'ILS'): PriceResult {
  return { ticker, status: 'success', price, currency };
}

function errorResult(ticker: string, error: string): PriceResult {
  return { ticker, status: 'error', error };
}

describe('MarketPriceService', () => {
  it('returns empty result for empty request list', async () => {
    const service = new MarketPriceService(stubFetcher([]));

    const result = await service.getPrices([]);

    expect(result.prices.size).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.fetchedAt).toBeDefined();
  });

  it('fetches price for a single security', async () => {
    const fetcher = stubFetcher([successResult('DELEK.TA', 120)]);
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: '1084128', ticker: 'DELEK.TA' },
    ]);

    expect(result.prices.get('1084128')).toEqual(expect.objectContaining({ price: 120, currency: 'ILS' }));
    expect(result.errors).toHaveLength(0);
  });

  it('fetches prices for multiple securities', async () => {
    const fetcher = stubFetcher([
      successResult('DELEK.TA', 120),
      successResult('TEVA.TA', 55, 'USD'),
    ]);
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: '1084128', ticker: 'DELEK.TA' },
      { securityId: '5554321', ticker: 'TEVA.TA' },
    ]);

    expect(result.prices.get('1084128')).toEqual(expect.objectContaining({ price: 120, currency: 'ILS' }));
    expect(result.prices.get('5554321')).toEqual(expect.objectContaining({ price: 55, currency: 'USD' }));
    expect(result.errors).toHaveLength(0);
  });

  it('handles partial failure — some succeed, some error', async () => {
    const fetcher = stubFetcher([
      successResult('DELEK.TA', 120),
      errorResult('UNKNOWN.TA', 'Ticker not found'),
    ]);
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: '1084128', ticker: 'DELEK.TA' },
      { securityId: '9999', ticker: 'UNKNOWN.TA' },
    ]);

    expect(result.prices.get('1084128')).toEqual(expect.objectContaining({ price: 120, currency: 'ILS' }));
    expect(result.prices.has('9999')).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      securityId: '9999',
      ticker: 'UNKNOWN.TA',
      reason: 'Ticker not found',
    });
  });

  it('handles complete fetcher failure gracefully — does not throw', async () => {
    const fetcher = throwingFetcher(new Error('Network error'));
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: '1084128', ticker: 'DELEK.TA' },
      { securityId: '5554321', ticker: 'TEVA.TA' },
    ]);

    expect(result.prices.size).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((e) => e.reason === 'Network error')).toBe(true);
  });

  it('deduplicates ticker fetches — same ticker for different securityIds', async () => {
    let fetchedTickers: readonly string[] = [];
    const fetcher: PriceFetcher = {
      async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
        fetchedTickers = tickers;
        return [successResult('DELEK.TA', 120)];
      },
    };
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: 'sec-1', ticker: 'DELEK.TA' },
      { securityId: 'sec-2', ticker: 'DELEK.TA' },
    ]);

    expect(fetchedTickers).toHaveLength(1);
    expect(result.prices.get('sec-1')).toEqual(expect.objectContaining({ price: 120, currency: 'ILS' }));
    expect(result.prices.get('sec-2')).toEqual(expect.objectContaining({ price: 120, currency: 'ILS' }));
  });

  it('handles fetcher returning fewer results than requested', async () => {
    const fetcher = stubFetcher([successResult('DELEK.TA', 120)]);
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: '1084128', ticker: 'DELEK.TA' },
      { securityId: '9999', ticker: 'MISSING.TA' },
    ]);

    expect(result.prices.get('1084128')).toEqual(expect.objectContaining({ price: 120, currency: 'ILS' }));
    expect(result.prices.has('9999')).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].securityId).toBe('9999');
    expect(result.errors[0].reason).toBe('no_response');
  });

  it('populates fetchedAt as ISO timestamp', async () => {
    const service = new MarketPriceService(stubFetcher([]));

    const before = new Date().toISOString();
    const result = await service.getPrices([]);
    const after = new Date().toISOString();

    expect(result.fetchedAt >= before).toBe(true);
    expect(result.fetchedAt <= after).toBe(true);
  });

  it('each PriceEntry carries fetchedAt matching the batch timestamp', async () => {
    const fetcher = stubFetcher([successResult('DELEK.TA', 120)]);
    const service = new MarketPriceService(fetcher);

    const before = new Date().toISOString();
    const result = await service.getPrices([{ securityId: '1084128', ticker: 'DELEK.TA' }]);
    const after = new Date().toISOString();

    const entry = result.prices.get('1084128')!;
    expect(entry.fetchedAt).toBeDefined();
    expect(entry.fetchedAt! >= before).toBe(true);
    expect(entry.fetchedAt! <= after).toBe(true);
    expect(entry.fetchedAt).toBe(result.fetchedAt);
  });

  it('carries currency through from fetcher results', async () => {
    const fetcher = stubFetcher([
      successResult('AAPL', 185, 'USD'),
      successResult('LEUMI.TA', 30, 'ILS'),
    ]);
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: 'apple', ticker: 'AAPL' },
      { securityId: 'leumi', ticker: 'LEUMI.TA' },
    ]);

    expect(result.prices.get('apple')!.currency).toBe('USD');
    expect(result.prices.get('leumi')!.currency).toBe('ILS');
  });

  it('rejects zero and negative prices as errors', async () => {
    const fetcher = stubFetcher([
      { ticker: 'ZERO.TA', status: 'success' as const, price: 0, currency: 'ILS' },
      { ticker: 'NEG.TA', status: 'success' as const, price: -1, currency: 'ILS' },
      successResult('VALID.TA', 50),
    ]);
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: 'zero-sec', ticker: 'ZERO.TA' },
      { securityId: 'neg-sec', ticker: 'NEG.TA' },
      { securityId: 'valid-sec', ticker: 'VALID.TA' },
    ]);

    expect(result.prices.has('zero-sec')).toBe(false);
    expect(result.prices.has('neg-sec')).toBe(false);
    expect(result.prices.get('valid-sec')).toEqual(expect.objectContaining({ price: 50, currency: 'ILS' }));
    expect(result.errors).toHaveLength(2);
    expect(result.errors.find((e) => e.securityId === 'zero-sec')!.reason).toContain('invalid_price');
    expect(result.errors.find((e) => e.securityId === 'neg-sec')!.reason).toContain('invalid_price');
  });

  it('handles large batch of 50+ tickers without issues', async () => {
    const count = 55;
    const results: PriceResult[] = Array.from({ length: count }, (_, i) =>
      successResult(`TICK${i}.TA`, 100 + i),
    );
    const fetcher = stubFetcher(results);
    const service = new MarketPriceService(fetcher);

    const requests: PriceRequest[] = Array.from({ length: count }, (_, i) => ({
      securityId: `sec-${i}`,
      ticker: `TICK${i}.TA`,
    }));

    const result = await service.getPrices(requests);

    expect(result.prices.size).toBe(count);
    expect(result.errors).toHaveLength(0);
    for (let i = 0; i < count; i++) {
      expect(result.prices.get(`sec-${i}`)!.price).toBe(100 + i);
    }
  });

  it('treats success status with undefined price as error', async () => {
    const fetcher = stubFetcher([
      { ticker: 'BAD.TA', status: 'success' as const, price: undefined, currency: 'ILS' },
    ]);
    const service = new MarketPriceService(fetcher);

    const result = await service.getPrices([
      { securityId: 'bad-sec', ticker: 'BAD.TA' },
    ]);

    expect(result.prices.has('bad-sec')).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].securityId).toBe('bad-sec');
    expect(result.errors[0].reason).toContain('invalid_price');
  });
});
