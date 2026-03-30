import { describe, expect, it, vi } from 'vitest';
import { TickerResolverService } from '../src/services/TickerResolverService';
import type { TickerSearcher } from '../src/ports/TickerSearcher';
import type { PortfolioRepository } from '../src/repositories/portfolioRepository';
import type { TickerMapping, TickerMappingStatus } from '../src/types/marketPrice';
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
    // ID search returns null, name search returns ticker
    const { searcher, calls } = trackingSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
    const service = new TickerResolverService(repo, searcher);

    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);

    expect(result.get('1084128')).toBeDefined();
    expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
    expect(result.get('1084128')!.resolvedBy).toBe('auto');
    // ID search + name search = 2 calls
    expect(calls).toHaveLength(2);

    // Verify it was persisted
    const cached = await repo.getTickerMapping('1084128');
    expect(cached).not.toBeNull();
    expect(cached!.ticker).toBe('DLEKG.TA');
  });

  it('returns cached ticker on second call without calling searcher', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
    const service = new TickerResolverService(repo, searcher);

    // First call — ID search + name search = 2 calls
    await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(calls).toHaveLength(2);

    // Second call — should use cache, no new calls
    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(calls).toHaveLength(2); // no new call
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

    // First instance resolves — ID search + name search = 2 calls
    const service1 = new TickerResolverService(repo, searcher);
    await service1.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(calls).toHaveLength(2);

    // Second instance — same repo, cached — no new search calls
    const service2 = new TickerResolverService(repo, searcher);
    const result = await service2.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);

    expect(calls).toHaveLength(2); // no new search call
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

    // Pre-cache one — ID search + name search = 2 calls
    await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
    ]);
    expect(calls).toHaveLength(2);

    // Resolve both — first is cached, second needs ID + name search = 2 more
    const result = await service.resolveAll([
      { securityId: '1084128', securityName: 'דלק קבוצה' },
      { securityId: '629014', securityName: 'טבע' },
    ]);

    expect(calls).toHaveLength(4); // 2 cached + 2 new (ID + name for טבע)
    expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
    expect(result.get('629014')!.ticker).toBe('TEVA.TA');
  });

  // -----------------------------------------------------------------------
  // deleteTickerMapping (repository level)
  // -----------------------------------------------------------------------

  describe('deleteTickerMapping', () => {
    it('deletes an existing mapping by securityId', async () => {
      const repo = makeRepo();
      const mapping: TickerMapping = {
        securityId: 'sec-1',
        securityName: 'Acme Corp',
        ticker: 'ACME',
        resolvedAt: '2026-01-01T00:00:00.000Z',
        resolvedBy: 'auto',
      };
      await repo.upsertTickerMapping(mapping);

      // Verify it exists
      expect(await repo.getTickerMapping('sec-1')).not.toBeNull();

      await repo.deleteTickerMapping('sec-1');

      expect(await repo.getTickerMapping('sec-1')).toBeNull();
    });

    it('is a no-op when securityId does not exist', async () => {
      const repo = makeRepo();
      // Should not throw
      await expect(repo.deleteTickerMapping('non-existent')).resolves.toBeUndefined();
    });

    it('does not affect other mappings when deleting one', async () => {
      const repo = makeRepo();
      const mappingA: TickerMapping = {
        securityId: 'sec-A',
        securityName: 'Alpha Corp',
        ticker: 'ALPH',
        resolvedAt: '2026-01-01T00:00:00.000Z',
        resolvedBy: 'auto',
      };
      const mappingB: TickerMapping = {
        securityId: 'sec-B',
        securityName: 'Beta Corp',
        ticker: 'BETA',
        resolvedAt: '2026-01-01T00:00:00.000Z',
        resolvedBy: 'auto',
      };
      await repo.upsertTickerMapping(mappingA);
      await repo.upsertTickerMapping(mappingB);

      await repo.deleteTickerMapping('sec-A');

      expect(await repo.getTickerMapping('sec-A')).toBeNull();
      expect(await repo.getTickerMapping('sec-B')).not.toBeNull();
      expect((await repo.getTickerMapping('sec-B'))!.ticker).toBe('BETA');
    });
  });

  // -----------------------------------------------------------------------
  // resetMapping
  // -----------------------------------------------------------------------

  describe('resetMapping', () => {
    it('deletes a cached auto-resolved mapping so next resolveAll re-invokes searchTicker', async () => {
      const repo = makeRepo();
      const { searcher, calls } = trackingSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
      const service = new TickerResolverService(repo, searcher);

      // First resolve — ID + name search = 2 calls
      await service.resolveAll([{ securityId: '1084128', securityName: 'דלק קבוצה' }]);
      expect(calls).toHaveLength(2);

      // Reset the mapping
      await service.resetMapping('1084128');

      // Mapping should no longer be in repository
      expect(await repo.getTickerMapping('1084128')).toBeNull();

      // Next resolve should re-invoke searchTicker — ID + name = 2 more calls
      const result = await service.resolveAll([{ securityId: '1084128', securityName: 'דלק קבוצה' }]);
      expect(calls).toHaveLength(4);
      expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
    });

    it('is a no-op when securityId does not exist — does not throw', async () => {
      const repo = makeRepo();
      const searcher = stubSearcher({});
      const service = new TickerResolverService(repo, searcher);

      await expect(service.resetMapping('non-existent')).resolves.toBeUndefined();
    });

    it('deletes a manual mapping — next resolve triggers auto-search', async () => {
      const repo = makeRepo();
      const { searcher, calls } = trackingSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
      const service = new TickerResolverService(repo, searcher);

      // Set manual mapping
      await service.setManualMapping('1084128', 'דלק קבוצה', 'DELEK.MANUAL');
      expect(calls).toHaveLength(0);

      // Reset it
      await service.resetMapping('1084128');
      expect(await repo.getTickerMapping('1084128')).toBeNull();

      // Next resolve should auto-search — ID + name = 2 calls
      const result = await service.resolveAll([{ securityId: '1084128', securityName: 'דלק קבוצה' }]);
      expect(calls).toHaveLength(2);
      expect(result.get('1084128')!.resolvedBy).toBe('auto');
      expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
    });
  });

  // -----------------------------------------------------------------------
  // listMappingsWithStatus
  // -----------------------------------------------------------------------

  describe('listMappingsWithStatus', () => {
    it('returns empty array when no mappings exist', async () => {
      const repo = makeRepo();
      const searcher = stubSearcher({});
      const service = new TickerResolverService(repo, searcher);

      const statuses = await service.listMappingsWithStatus();
      expect(statuses).toEqual([]);
    });

    it('returns status "resolved" for auto-resolved mapping with a ticker', async () => {
      const repo = makeRepo();
      const searcher = stubSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
      const service = new TickerResolverService(repo, searcher);

      await service.resolveAll([{ securityId: '1084128', securityName: 'דלק קבוצה' }]);

      const statuses = await service.listMappingsWithStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].securityId).toBe('1084128');
      expect(statuses[0].securityName).toBe('דלק קבוצה');
      expect(statuses[0].ticker).toBe('DLEKG.TA');
      expect(statuses[0].resolvedBy).toBe('auto');
      expect(statuses[0].status).toBe('resolved');
    });

    it('returns status "failed" for auto-resolved mapping with null ticker', async () => {
      const repo = makeRepo();
      const searcher = stubSearcher({}); // no match
      const service = new TickerResolverService(repo, searcher);

      await service.resolveAll([{ securityId: '9999', securityName: 'Unknown Corp' }]);

      const statuses = await service.listMappingsWithStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].securityId).toBe('9999');
      expect(statuses[0].ticker).toBeNull();
      expect(statuses[0].resolvedBy).toBe('auto');
      expect(statuses[0].status).toBe('failed');
    });

    it('returns status "manual" for manually-set mapping', async () => {
      const repo = makeRepo();
      const searcher = stubSearcher({});
      const service = new TickerResolverService(repo, searcher);

      await service.setManualMapping('1084128', 'דלק קבוצה', 'DELEK.TA');

      const statuses = await service.listMappingsWithStatus();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].securityId).toBe('1084128');
      expect(statuses[0].ticker).toBe('DELEK.TA');
      expect(statuses[0].resolvedBy).toBe('manual');
      expect(statuses[0].status).toBe('manual');
    });

    it('returns all mappings across multiple securities with correct status derivation', async () => {
      const repo = makeRepo();
      const searcher = stubSearcher({ 'דלק קבוצה': 'DLEKG.TA' }); // 'Unknown' has no match
      const service = new TickerResolverService(repo, searcher);

      // Auto-resolved with match
      await service.resolveAll([{ securityId: 'sec-1', securityName: 'דלק קבוצה' }]);
      // Auto-resolved with no match (null ticker)
      await service.resolveAll([{ securityId: 'sec-2', securityName: 'Unknown' }]);
      // Manual
      await service.setManualMapping('sec-3', 'Acme', 'ACME');

      const statuses = await service.listMappingsWithStatus();
      expect(statuses).toHaveLength(3);

      const byId = Object.fromEntries(statuses.map((s) => [s.securityId, s]));
      expect(byId['sec-1'].status).toBe('resolved');
      expect(byId['sec-2'].status).toBe('failed');
      expect(byId['sec-3'].status).toBe('manual');
    });
  });

  describe('TASE fund resolution via static table', () => {
    it('resolves known TASE fund ID to itself via static table (ticker === securityId)', async () => {
      const repo = makeRepo();
      const { searcher, calls } = trackingSearcher({});
      const { IsraeliSecurityLookupImpl } = await import('../src/data/israeliSecurities');
      const service = new TickerResolverService(repo, searcher, new IsraeliSecurityLookupImpl());

      const result = await service.resolveAll([
        { securityId: '1183441', securityName: 'S&P500 אינ.חוץ' },
      ]);

      const mapping = result.get('1183441');
      expect(mapping).toBeDefined();
      expect(mapping!.ticker).toBe('1183441');
      expect(mapping!.resolvedBy).toBe('static-table');
      // Searcher must NOT be called — resolved from static table
      expect(calls).toHaveLength(0);
    });

    it('caches fund static-table result — second call hits repo without calling searcher', async () => {
      const repo = makeRepo();
      const { searcher, calls } = trackingSearcher({});
      const { IsraeliSecurityLookupImpl } = await import('../src/data/israeliSecurities');
      const service = new TickerResolverService(repo, searcher, new IsraeliSecurityLookupImpl());

      await service.resolveAll([{ securityId: '5112628', securityName: '125 תא.IBI' }]);
      await service.resolveAll([{ securityId: '5112628', securityName: '125 תא.IBI' }]);

      expect(calls).toHaveLength(0);
      const cached = await repo.getTickerMapping('5112628');
      expect(cached!.ticker).toBe('5112628');
      expect(cached!.resolvedBy).toBe('static-table');
    });

    it('known stock ID resolves to .TA ticker, not to itself', async () => {
      const repo = makeRepo();
      const { searcher, calls } = trackingSearcher({});
      const { IsraeliSecurityLookupImpl } = await import('../src/data/israeliSecurities');
      const service = new TickerResolverService(repo, searcher, new IsraeliSecurityLookupImpl());

      // 604611 = Bank Leumi (LUMI.TA) in ISRAELI_SECURITY_TABLE
      const result = await service.resolveAll([
        { securityId: '604611', securityName: 'בנק לאומי' },
      ]);

      const mapping = result.get('604611');
      expect(mapping!.ticker).toBe('LUMI.TA');
      expect(mapping!.resolvedBy).toBe('static-table');
      expect(calls).toHaveLength(0);
    });

    it('manual override takes precedence over static table fund entry', async () => {
      const repo = makeRepo();
      const searcher = stubSearcher({});
      const { IsraeliSecurityLookupImpl } = await import('../src/data/israeliSecurities');
      const service = new TickerResolverService(repo, searcher, new IsraeliSecurityLookupImpl());

      await service.setManualMapping('1183441', 'S&P500 אינ.חוץ', 'CUSTOM.TICKER');

      const result = await service.resolveAll([
        { securityId: '1183441', securityName: 'S&P500 אינ.חוץ' },
      ]);

      const mapping = result.get('1183441');
      expect(mapping!.ticker).toBe('CUSTOM.TICKER');
      expect(mapping!.resolvedBy).toBe('manual');
    });
  });
});
