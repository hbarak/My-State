import { describe, expect, it, vi } from 'vitest';
import { TickerResolverService } from '../src/services/TickerResolverService';
import type { TickerSearcher } from '../src/ports/TickerSearcher';
import type { PortfolioRepository } from '../src/repositories/portfolioRepository';
import type { TickerMapping } from '../src/types/marketPrice';
import { InMemoryJsonStore } from '../src/stores/jsonStores';
import { LocalPortfolioRepository } from '../src/repositories/portfolioRepository';

interface SecurityInput {
  readonly securityId: string;
  readonly securityName: string;
}

function stubSearcher(results: Record<string, string | null>): TickerSearcher {
  return {
    async searchTicker(securityName: string): Promise<string | null> {
      return results[securityName] ?? null;
    },
  };
}

function trackingSearcher(results: Record<string, string | null>): {
  searcher: TickerSearcher;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    searcher: {
      async searchTicker(securityName: string): Promise<string | null> {
        calls.push(securityName);
        return results[securityName] ?? null;
      },
    },
    calls,
  };
}

function throwingSearcher(error: Error): TickerSearcher {
  return {
    async searchTicker(): Promise<string | null> {
      throw error;
    },
  };
}

function makeRepo(): PortfolioRepository {
  return new LocalPortfolioRepository(new InMemoryJsonStore());
}

describe('TickerResolverService', () => {
  it('auto-resolves a security name to a ticker and caches it', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
    const service = new TickerResolverService(repo, searcher);

    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);

    expect(result.get('1084128')).toBeDefined();
    expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
    expect(result.get('1084128')!.resolvedBy).toBe('auto');
    expect(calls).toHaveLength(1);

    // Verify it was persisted
    const cached = await repo.getTickerMapping('1084128');
    expect(cached).not.toBeNull();
    expect(cached!.ticker).toBe('DLEKG.TA');
  });

  it('returns cached ticker on second call without calling searcher', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
    const service = new TickerResolverService(repo, searcher);

    // First call — should search
    await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(calls).toHaveLength(1);

    // Second call — should use cache
    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(calls).toHaveLength(1); // no new call
    expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
  });

  it('returns null mapping when no match found — does not throw', async () => {
    const repo = makeRepo();
    const searcher = stubSearcher({});
    const service = new TickerResolverService(repo, searcher);

    const result = await service.resolveAll([
      { securityId: '9999', securityName: 'Unknown Corp' },
    ]);

    expect(result.get('9999')).toBeDefined();
    expect(result.get('9999')!.ticker).toBeNull();
    expect(result.get('9999')!.resolvedBy).toBe('auto');

    // Null result should also be cached
    const cached = await repo.getTickerMapping('9999');
    expect(cached).not.toBeNull();
    expect(cached!.ticker).toBeNull();
  });

  it('handles search API failure gracefully — returns null, does NOT cache failure', async () => {
    const repo = makeRepo();
    const searcher = throwingSearcher(new Error('Yahoo API down'));
    const service = new TickerResolverService(repo, searcher);

    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);

    expect(result.get('1084128')).toBeNull();

    // Should NOT have cached the failure
    const cached = await repo.getTickerMapping('1084128');
    expect(cached).toBeNull();
  });

  it('manual override takes precedence over cached auto value', async () => {
    const repo = makeRepo();
    const searcher = stubSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
    const service = new TickerResolverService(repo, searcher);

    // Auto-resolve first
    await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);

    // Manual override
    const manual = await service.setManualMapping('1084128', 'דלק קבוצה', 'DELEK.TA');
    expect(manual.ticker).toBe('DELEK.TA');
    expect(manual.resolvedBy).toBe('manual');

    // Subsequent resolve should return manual mapping
    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(result.get('1084128')!.ticker).toBe('DELEK.TA');
    expect(result.get('1084128')!.resolvedBy).toBe('manual');
  });

  it('mappings survive across service instantiation (persistence)', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({ 'דלק קבוצה': 'DLEKG.TA' });

    // First instance resolves
    const service1 = new TickerResolverService(repo, searcher);
    await service1.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(calls).toHaveLength(1);

    // Second instance — same repo, new service
    const service2 = new TickerResolverService(repo, searcher);
    const result = await service2.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);

    expect(calls).toHaveLength(1); // no new search call
    expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
  });

  it('handles Hebrew security names (real Psagot names)', async () => {
    const repo = makeRepo();
    const searcher = stubSearcher({
      'דלק קבוצה': 'DLEKG.TA',
      'לאומי': 'LUMI.TA',
      'טבע': 'TEVA.TA',
    });
    const service = new TickerResolverService(repo, searcher);

    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
      { securityId: '604611', securityName: 'לאומי' },
      { securityId: '629014', securityName: 'טבע' },
    ]);

    expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
    expect(result.get('604611')!.ticker).toBe('LUMI.TA');
    expect(result.get('629014')!.ticker).toBe('TEVA.TA');
  });

  it('resolved Israeli tickers have .TA suffix (TASE format)', async () => {
    const repo = makeRepo();
    // Searcher returns .TA suffix tickers as Yahoo does for TASE
    const searcher = stubSearcher({ 'לאומי': 'LUMI.TA' });
    const service = new TickerResolverService(repo, searcher);

    const result = await service.resolveAll([
      { securityId: '604611', securityName: 'לאומי' },
    ]);

    expect(result.get('604611')!.ticker).toBe('LUMI.TA');
    expect(result.get('604611')!.ticker!.endsWith('.TA')).toBe(true);
  });

  it('resolves multiple securities in one call — mix of cache hit and miss', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({
      'דלק קבוצה': 'DLEKG.TA',
      'טבע': 'TEVA.TA',
    });
    const service = new TickerResolverService(repo, searcher);

    // Pre-cache one
    await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(calls).toHaveLength(1);

    // Resolve both — one cached, one new
    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
      { securityId: '629014', securityName: 'טבע' },
    ]);

    expect(calls).toHaveLength(2); // only one new search call
    expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
    expect(result.get('629014')!.ticker).toBe('TEVA.TA');
  });
});
