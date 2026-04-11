import type { DataSource } from '../types/dataSource';
import type { Provider } from '../types/provider';

// ─────────────────────────────────────────────────────────────────────────────
// Data Source Catalog
//
// Declares all known data sources and their capabilities.
// When adding a new data source, add it here first — this is the
// single source of truth for "what does this source do?"
//
// Checklist for a new data source:
//   1. Define a DataSource entry below
//   2. Check capabilities — which of these can the source do?
//      - price_fetch:        return current/delayed prices for securities
//      - ticker_resolution:  resolve a symbol or name → internal security ID
//      - security_metadata:  return name, exchange, currency, type for securities
//      - financial_data:     return fundamentals (revenue, balance sheet, etc.)
//      - market_history:     return historical/intraday OHLCV candles
//   3. Set priceCoverage — what securities can it price?
//      - own_holdings:       only positions the linked provider holds
//      - exchange_domestic:  domestic exchange only (e.g. TASE)
//      - exchange_global:    any exchange-listed security worldwide
//      - universal:          any security it can resolve (broadest)
//   4. Set securityIdScheme — how does it identify securities?
//   5. Set authMethod — how does it authenticate?
//      - If 'provider_session': set providerId to the linked Provider
//   6. Implement the adapter (PriceFetcher, etc.)
//   7. Wire into the routing layer
// ─────────────────────────────────────────────────────────────────────────────

const now = '2026-04-11T00:00:00.000Z';

// ── Provider IDs (re-declared here for linking) ─────────────────────────────

export const PSAGOT_PROVIDER_ID = 'provider-psagot';

// ── Data Source IDs ─────────────────────────────────────────────────────────

export const DATASOURCE_PSAGOT_ID = 'datasource-psagot';
export const DATASOURCE_EODHD_ID = 'datasource-eodhd';
export const DATASOURCE_MAYA_ID = 'datasource-maya';

// ── Data Source Declarations ────────────────────────────────────────────────

/**
 * Psagot — Israeli broker that also serves as a rich market data source.
 *
 * Uses the same authenticated session as the Provider (Psagot holdings sync).
 * When the session is active, can price ANY security via autoComplete resolution.
 * When session expires, becomes unavailable — fallback sources handle pricing.
 *
 * Endpoints used:
 *   - market/table/simple  → price_fetch, security_metadata
 *   - autoComplete/search  → ticker_resolution
 *   - market/companies/financial → financial_data
 *   - market/history/intraday   → market_history
 *   - market/analysts/score     → (future capability)
 */
export const DATASOURCE_PSAGOT: DataSource = {
  id: DATASOURCE_PSAGOT_ID,
  name: 'Psagot',
  status: 'active',
  capabilities: ['price_fetch', 'ticker_resolution', 'security_metadata', 'financial_data', 'market_history'],
  priceCoverage: 'universal',
  securityIdScheme: 'equity_number',
  authMethod: 'provider_session',
  providerId: PSAGOT_PROVIDER_ID,
  pricePriority: 10,
  createdAt: now,
  updatedAt: now,
};

/**
 * EODHD — global equity data provider. API-key authenticated, no user context.
 *
 * Covers any exchange-listed security worldwide.
 * Limited by daily quota (20 calls/day on free tier).
 * Used as the primary fallback for symbol-based tickers when no
 * provider session is available.
 *
 * Also used for ticker resolution (searchTicker via EodhdTickerSearcher).
 */
export const DATASOURCE_EODHD: DataSource = {
  id: DATASOURCE_EODHD_ID,
  name: 'EODHD',
  status: 'active',
  capabilities: ['price_fetch', 'ticker_resolution'],
  priceCoverage: 'exchange_global',
  securityIdScheme: 'ticker_symbol',
  authMethod: 'api_key',
  pricePriority: 50,
  createdAt: now,
  updatedAt: now,
};

/**
 * Maya/TASE — Israeli stock exchange public API.
 *
 * Covers TASE mutual funds only (identified by all-digit numeric IDs).
 * No authentication required. No quota limits known.
 * Used specifically for TASE fund prices that EODHD doesn't cover well.
 */
export const DATASOURCE_MAYA: DataSource = {
  id: DATASOURCE_MAYA_ID,
  name: 'Maya (TASE)',
  status: 'active',
  capabilities: ['price_fetch'],
  priceCoverage: 'exchange_domestic',
  securityIdScheme: 'equity_number',
  authMethod: 'none',
  pricePriority: 20,
  createdAt: now,
  updatedAt: now,
};

/**
 * All registered data sources, in priority order.
 */
export const DATA_SOURCE_CATALOG: readonly DataSource[] = [
  DATASOURCE_PSAGOT,
  DATASOURCE_MAYA,
  DATASOURCE_EODHD,
];

// ── Provider capability declarations ────────────────────────────────────────
// These are the canonical capability sets. Used when seeding providers in bootstrap.

/**
 * Psagot provider capabilities.
 * - holdings_import:    via API (fetchBalances) or CSV (Hebrew holdings export)
 * - account_discovery:  via API (fetchAccounts)
 * - trade_import:       not yet (Psagot trade history endpoint not discovered)
 */
export const PSAGOT_PROVIDER_CAPABILITIES: Provider['capabilities'] = [
  'holdings_import',
  'account_discovery',
] as const;

/**
 * CSV-only provider capabilities.
 * CSV imports are passive — no API, no auth, no account discovery.
 * What you get depends on the file format (trades CSV vs holdings CSV).
 */
export const CSV_PROVIDER_CAPABILITIES: Provider['capabilities'] = [
  'holdings_import',
  'trade_import',
] as const;
