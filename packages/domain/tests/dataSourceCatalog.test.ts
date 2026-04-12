import { describe, it, expect } from 'vitest';
import type { DataSource } from '../src/types/dataSource';
import {
  DATA_SOURCE_CATALOG,
  DATASOURCE_PSAGOT,
  DATASOURCE_EODHD,
  DATASOURCE_MAYA,
  DATASOURCE_IB,
  PSAGOT_PROVIDER_CAPABILITIES,
  IB_PROVIDER_CAPABILITIES,
  CSV_PROVIDER_CAPABILITIES,
} from '../src/data/dataSourceCatalog';

// ─────────────────────────────────────────────────────────────────────────────
// Catalog-level invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('DataSource Catalog', () => {
  it('contains all registered sources', () => {
    expect(DATA_SOURCE_CATALOG).toHaveLength(4);
    const ids = DATA_SOURCE_CATALOG.map((s) => s.id);
    expect(ids).toContain(DATASOURCE_PSAGOT.id);
    expect(ids).toContain(DATASOURCE_EODHD.id);
    expect(ids).toContain(DATASOURCE_MAYA.id);
    expect(ids).toContain(DATASOURCE_IB.id);
  });

  it('has unique IDs across all sources', () => {
    const ids = DATA_SOURCE_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every source with price_fetch has priceCoverage set', () => {
    for (const source of DATA_SOURCE_CATALOG) {
      if (source.capabilities.includes('price_fetch')) {
        expect(source.priceCoverage).toBeDefined();
        expect(source.pricePriority).toBeDefined();
      }
    }
  });

  it('every source with provider_session auth has a providerId', () => {
    for (const source of DATA_SOURCE_CATALOG) {
      if (source.authMethod === 'provider_session') {
        expect(source.providerId).toBeTruthy();
      }
    }
  });

  it('sources linked to a provider have a providerId', () => {
    for (const source of DATA_SOURCE_CATALOG) {
      if (source.authMethod === 'provider_session' || source.authMethod === 'gateway') {
        expect(source.providerId).toBeTruthy();
      }
    }
  });

  it('standalone sources (api_key, none) do not have a providerId', () => {
    for (const source of DATA_SOURCE_CATALOG) {
      if (source.authMethod === 'api_key' || source.authMethod === 'none') {
        expect(source.providerId).toBeUndefined();
      }
    }
  });

  it('catalog is sorted by pricePriority (lower = preferred)', () => {
    const withPriority = DATA_SOURCE_CATALOG.filter((s): s is DataSource & { pricePriority: number } =>
      s.pricePriority !== undefined,
    );
    for (let i = 1; i < withPriority.length; i++) {
      expect(withPriority[i].pricePriority).toBeGreaterThanOrEqual(withPriority[i - 1].pricePriority);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-source capability contracts
// ─────────────────────────────────────────────────────────────────────────────

describe('Psagot DataSource', () => {
  it('is a universal price source backed by provider session', () => {
    expect(DATASOURCE_PSAGOT.capabilities).toContain('price_fetch');
    expect(DATASOURCE_PSAGOT.priceCoverage).toBe('universal');
    expect(DATASOURCE_PSAGOT.authMethod).toBe('provider_session');
    expect(DATASOURCE_PSAGOT.providerId).toBeTruthy();
  });

  it('can resolve tickers and fetch metadata', () => {
    expect(DATASOURCE_PSAGOT.capabilities).toContain('ticker_resolution');
    expect(DATASOURCE_PSAGOT.capabilities).toContain('security_metadata');
  });

  it('uses equity_number as security ID scheme', () => {
    expect(DATASOURCE_PSAGOT.securityIdScheme).toBe('equity_number');
  });

  it('has highest price priority (preferred when available)', () => {
    expect(DATASOURCE_PSAGOT.pricePriority).toBe(10);
    expect(DATASOURCE_PSAGOT.pricePriority!).toBeLessThan(DATASOURCE_EODHD.pricePriority!);
  });
});

describe('EODHD DataSource', () => {
  it('is a global exchange price source with API key auth', () => {
    expect(DATASOURCE_EODHD.capabilities).toContain('price_fetch');
    expect(DATASOURCE_EODHD.priceCoverage).toBe('exchange_global');
    expect(DATASOURCE_EODHD.authMethod).toBe('api_key');
  });

  it('uses ticker_symbol as security ID scheme', () => {
    expect(DATASOURCE_EODHD.securityIdScheme).toBe('ticker_symbol');
  });

  it('is not linked to any provider', () => {
    expect(DATASOURCE_EODHD.providerId).toBeUndefined();
  });

  it('has lower priority than Psagot (fallback role)', () => {
    expect(DATASOURCE_EODHD.pricePriority!).toBeGreaterThan(DATASOURCE_PSAGOT.pricePriority!);
  });
});

describe('Maya DataSource', () => {
  it('is a domestic exchange price source with no auth', () => {
    expect(DATASOURCE_MAYA.capabilities).toContain('price_fetch');
    expect(DATASOURCE_MAYA.priceCoverage).toBe('exchange_domestic');
    expect(DATASOURCE_MAYA.authMethod).toBe('none');
  });

  it('only provides price_fetch (no resolution or metadata)', () => {
    expect(DATASOURCE_MAYA.capabilities).toEqual(['price_fetch']);
  });

  it('uses equity_number as security ID scheme', () => {
    expect(DATASOURCE_MAYA.securityIdScheme).toBe('equity_number');
  });

  it('is not linked to any provider', () => {
    expect(DATASOURCE_MAYA.providerId).toBeUndefined();
  });
});

describe('IB DataSource', () => {
  it('is an own-holdings price source backed by local gateway', () => {
    expect(DATASOURCE_IB.capabilities).toContain('price_fetch');
    expect(DATASOURCE_IB.priceCoverage).toBe('own_holdings');
    expect(DATASOURCE_IB.authMethod).toBe('gateway');
    expect(DATASOURCE_IB.providerId).toBeTruthy();
  });

  it('uses conid as security ID scheme', () => {
    expect(DATASOURCE_IB.securityIdScheme).toBe('conid');
  });

  it('has priority between Psagot and Maya', () => {
    expect(DATASOURCE_IB.pricePriority!).toBeGreaterThan(DATASOURCE_PSAGOT.pricePriority!);
    expect(DATASOURCE_IB.pricePriority!).toBeLessThan(DATASOURCE_MAYA.pricePriority!);
  });

  it('provides security_metadata (contract descriptions from gateway)', () => {
    expect(DATASOURCE_IB.capabilities).toContain('security_metadata');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider capability declarations
// ─────────────────────────────────────────────────────────────────────────────

describe('Provider capability declarations', () => {
  it('Psagot provider can import holdings and discover accounts', () => {
    expect(PSAGOT_PROVIDER_CAPABILITIES).toContain('holdings_import');
    expect(PSAGOT_PROVIDER_CAPABILITIES).toContain('account_discovery');
  });

  it('Psagot provider does not claim trade_import (not yet supported)', () => {
    expect(PSAGOT_PROVIDER_CAPABILITIES).not.toContain('trade_import');
  });

  it('CSV provider can import holdings and trades', () => {
    expect(CSV_PROVIDER_CAPABILITIES).toContain('holdings_import');
    expect(CSV_PROVIDER_CAPABILITIES).toContain('trade_import');
  });

  it('CSV provider does not claim account_discovery (passive import)', () => {
    expect(CSV_PROVIDER_CAPABILITIES).not.toContain('account_discovery');
  });

  it('IB provider can import holdings and discover accounts', () => {
    expect(IB_PROVIDER_CAPABILITIES).toContain('holdings_import');
    expect(IB_PROVIDER_CAPABILITIES).toContain('account_discovery');
  });

  it('IB provider does not claim trade_import (not yet supported)', () => {
    expect(IB_PROVIDER_CAPABILITIES).not.toContain('trade_import');
  });
});
