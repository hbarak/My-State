/**
 * S6-DEV-03: Israeli security number ticker lookup tests (AC 6 + AC 7)
 *
 * Tests the new IsraeliSecurityLookup port and its integration into
 * TickerResolverService as step 2 (static table lookup before name-search).
 */
import { describe, expect, it } from 'vitest';
import { ISRAELI_SECURITY_TABLE, IsraeliSecurityLookupImpl } from '../src/data/israeliSecurities';
import { TickerResolverService } from '../src/services/TickerResolverService';
import type { TickerSearcher } from '../src/ports/TickerSearcher';
import { InMemoryJsonStore } from '../src/stores/jsonStores';
import { LocalPortfolioRepository } from '../src/repositories/portfolioRepository';

function makeRepo() {
  return new LocalPortfolioRepository(new InMemoryJsonStore());
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

function nullSearcher(): TickerSearcher {
  return {
    async searchTicker(): Promise<string | null> {
      return null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IsraeliSecurityLookup port — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('IsraeliSecurityLookupImpl (AC 6)', () => {
  it('returns ticker for a known 8-digit Israeli security number', () => {
    const lookup = new IsraeliSecurityLookupImpl();
    // Pick a known entry from the static table
    const knownId = [...ISRAELI_SECURITY_TABLE.keys()][0]!;
    const expectedTicker = ISRAELI_SECURITY_TABLE.get(knownId)!;

    const result = lookup.lookup(knownId);
    expect(result).toBe(expectedTicker);
  });

  it('returns null for an unknown security number', () => {
    const lookup = new IsraeliSecurityLookupImpl();
    const result = lookup.lookup('00000000');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const lookup = new IsraeliSecurityLookupImpl();
    expect(lookup.lookup('')).toBeNull();
  });

  it('static table contains at least one known Psagot security', () => {
    // Ensure the table is populated and not empty
    expect(ISRAELI_SECURITY_TABLE.size).toBeGreaterThan(0);
    // All values should be non-empty ticker strings
    for (const [id, ticker] of ISRAELI_SECURITY_TABLE.entries()) {
      expect(id.length).toBeGreaterThan(0);
      expect(ticker.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TickerResolverService — step 2 integration (static table lookup)
// ─────────────────────────────────────────────────────────────────────────────

describe('TickerResolverService — Israeli security lookup integration (AC 6 + AC 7)', () => {
  it('AC6-step2-hit: known Israeli security ID resolves from static table — no name-search call', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({});
    const lookup = new IsraeliSecurityLookupImpl();
    const service = new TickerResolverService(repo, searcher, lookup);

    const knownId = [...ISRAELI_SECURITY_TABLE.keys()][0]!;
    const expectedTicker = ISRAELI_SECURITY_TABLE.get(knownId)!;

    const result = await service.resolveAll([{ securityId: knownId, securityName: 'כלשהו' }]);

    expect(result.get(knownId)).not.toBeNull();
    expect(result.get(knownId)!.ticker).toBe(expectedTicker);
    expect(calls).toHaveLength(0); // name-search was NOT called
  });

  it('AC6-step2-miss: unknown ID falls through to name-search', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({ 'Some Corp': 'SOME.TA' });
    const lookup = new IsraeliSecurityLookupImpl();
    const service = new TickerResolverService(repo, searcher, lookup);

    const result = await service.resolveAll([{ securityId: '00000000', securityName: 'Some Corp' }]);

    expect(result.get('00000000')!.ticker).toBe('SOME.TA');
    expect(calls).toHaveLength(1); // name-search was called
  });

  it('AC7-cache: resolving same ID twice only searches once (cache hit on step 1)', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({});
    const lookup = new IsraeliSecurityLookupImpl();
    const service = new TickerResolverService(repo, searcher, lookup);

    const knownId = [...ISRAELI_SECURITY_TABLE.keys()][0]!;

    // First call — resolves from static table
    await service.resolveAll([{ securityId: knownId, securityName: 'כלשהו' }]);
    // Second call — should hit repo cache (step 1)
    await service.resolveAll([{ securityId: knownId, securityName: 'כלשהו' }]);

    expect(calls).toHaveLength(0); // name-search never called
    const cached = await repo.getTickerMapping(knownId);
    expect(cached).not.toBeNull();
  });

  it('AC7-persistence: static table result is persisted to repo for future sessions', async () => {
    const repo = makeRepo();
    const lookup = new IsraeliSecurityLookupImpl();
    const service = new TickerResolverService(repo, nullSearcher(), lookup);

    const knownId = [...ISRAELI_SECURITY_TABLE.keys()][0]!;
    const expectedTicker = ISRAELI_SECURITY_TABLE.get(knownId)!;

    await service.resolveAll([{ securityId: knownId, securityName: 'כלשהו' }]);

    // Verify persisted
    const cached = await repo.getTickerMapping(knownId);
    expect(cached).not.toBeNull();
    expect(cached!.ticker).toBe(expectedTicker);
    expect(cached!.resolvedBy).toBe('static-table');
  });

  it('manual override takes precedence over static table', async () => {
    const repo = makeRepo();
    const lookup = new IsraeliSecurityLookupImpl();
    const service = new TickerResolverService(repo, nullSearcher(), lookup);

    const knownId = [...ISRAELI_SECURITY_TABLE.keys()][0]!;

    // Set manual override first
    await service.setManualMapping(knownId, 'Custom Corp', 'CUSTOM.TA');

    // resolveAll should return manual mapping
    const result = await service.resolveAll([{ securityId: knownId, securityName: 'Custom Corp' }]);
    expect(result.get(knownId)!.ticker).toBe('CUSTOM.TA');
    expect(result.get(knownId)!.resolvedBy).toBe('manual');
  });

  it('resolves mix of known Israeli IDs and unknown IDs in one call', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({ 'Unknown Corp': 'UNKN.TA' });
    const lookup = new IsraeliSecurityLookupImpl();
    const service = new TickerResolverService(repo, searcher, lookup);

    const knownId = [...ISRAELI_SECURITY_TABLE.keys()][0]!;
    const expectedTicker = ISRAELI_SECURITY_TABLE.get(knownId)!;

    const result = await service.resolveAll([
      { securityId: knownId, securityName: 'Known Corp' },
      { securityId: '00000000', securityName: 'Unknown Corp' },
    ]);

    expect(result.get(knownId)!.ticker).toBe(expectedTicker);
    expect(result.get('00000000')!.ticker).toBe('UNKN.TA');
    expect(calls).toHaveLength(1); // only one name-search for the unknown ID
  });

  it('resolveAll without IsraeliSecurityLookup (backwards-compatible — lookup is optional)', async () => {
    const repo = makeRepo();
    const { searcher, calls } = trackingSearcher({ 'דלק קבוצה': 'DLEKG.TA' });
    // No lookup passed — constructor without third arg
    const service = new TickerResolverService(repo, searcher);

    const result = await service.resolveAll([{ securityId: '1084128', securityName: 'דלק קבוצה' }]);
    expect(result.get('1084128')!.ticker).toBe('DLEKG.TA');
    expect(calls).toHaveLength(1);
  });
});
