import type { ISODateTime } from './common';

// ─────────────────────────────────────────────────────────────────────────────
// Data Source — a system that supplies market data (prices, metadata, resolution)
//
// Distinct from Provider (which holds user data: holdings, trades, accounts).
// A DataSource may be standalone (EODHD, Maya) or backed by a Provider
// (Psagot prices use the same session as Psagot holdings).
//
// When adding a new data source, declare its capabilities and coverage here.
// The routing layer (FanOutPriceFetcher) uses these declarations to decide
// which source handles which tickers.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a data source can supply to the system.
 *
 * When integrating a new data source, check each capability:
 * - `price_fetch`        — can it return current/delayed prices?
 * - `ticker_resolution`  — can it map a symbol or name → canonical security ID?
 * - `security_metadata`  — can it return name, exchange, currency, type for a security?
 * - `financial_data`     — can it return fundamentals (revenue, earnings, balance sheet)?
 * - `market_history`     — can it return historical/intraday OHLCV candles?
 */
export type DataSourceCapability =
  | 'price_fetch'
  | 'ticker_resolution'
  | 'security_metadata'
  | 'financial_data'
  | 'market_history';

/**
 * What universe of securities this source covers for price_fetch.
 *
 * - `own_holdings`      — only securities the linked provider currently holds
 *                         (e.g. IB market data for positions only)
 * - `exchange_domestic`  — a specific domestic exchange (e.g. Maya covers TASE only)
 * - `exchange_global`    — any exchange-listed security worldwide (e.g. EODHD)
 * - `universal`          — any security it can resolve, regardless of holdings or exchange
 *                         (e.g. Psagot via autoComplete: resolve symbol → equity number → price)
 */
export type DataSourcePriceCoverage =
  | 'own_holdings'
  | 'exchange_domestic'
  | 'exchange_global'
  | 'universal';

/**
 * How this data source identifies securities.
 *
 * Affects how the routing layer translates between the system's ticker format
 * and the source's native identifier. A source with `equity_number` needs
 * all-digit Psagot IDs; `ticker_symbol` needs exchange-suffixed symbols.
 */
export type DataSourceSecurityIdScheme =
  | 'equity_number'   // Psagot internal IDs — all-digit (e.g. "1183441", "72703929")
  | 'ticker_symbol'   // Exchange tickers (e.g. "AAPL", "DLEKG.TA")
  | 'isin'            // ISO 6166 international ID (future)
  | 'conid';          // Interactive Brokers contract ID (future)

/**
 * How this data source authenticates.
 *
 * - `none`            — no auth required (Maya)
 * - `api_key`         — static API key, typically env var (EODHD)
 * - `provider_session` — piggybacks on a Provider's authenticated session (Psagot prices)
 * - `oauth`           — OAuth 2.0 flow (future)
 * - `gateway`         — local gateway process manages auth (IB Client Portal, future)
 */
export type DataSourceAuthMethod =
  | 'none'
  | 'api_key'
  | 'provider_session'
  | 'oauth'
  | 'gateway';

export type DataSourceStatus = 'active' | 'inactive';

/**
 * A market data source declaration.
 *
 * This is a **capability declaration**, not an implementation. Each data source
 * still needs an adapter (implementing `PriceFetcher`, etc.) — this type tells
 * the system what the adapter can do, what it covers, and how to route to it.
 *
 * When adding a new data source:
 * 1. Create a `DataSource` declaration with its capabilities and coverage
 * 2. Implement the relevant adapter interfaces (PriceFetcher, etc.)
 * 3. Wire it into the routing layer (FanOutPriceFetcher or equivalent)
 * 4. If `authMethod === 'provider_session'`, set `providerId` to link the session
 */
export interface DataSource {
  /** Unique identifier (e.g. "datasource-psagot", "datasource-eodhd") */
  readonly id: string;
  /** Human-readable name for UI display */
  readonly name: string;
  readonly status: DataSourceStatus;

  /** What this source can supply */
  readonly capabilities: readonly DataSourceCapability[];

  /** What securities this source covers for price_fetch (required if price_fetch in capabilities) */
  readonly priceCoverage?: DataSourcePriceCoverage;

  /** How this source identifies securities natively */
  readonly securityIdScheme: DataSourceSecurityIdScheme;

  /** How this source authenticates */
  readonly authMethod: DataSourceAuthMethod;

  /**
   * If `authMethod === 'provider_session'`, the Provider whose session this source uses.
   * The data source cannot function without an active session from this provider.
   * This is the explicit link between "Psagot the broker" and "Psagot the price source".
   */
  readonly providerId?: string;

  /**
   * Priority for price_fetch routing (lower = preferred).
   * When multiple sources can price the same security, the router tries them in priority order.
   * Example: Psagot (10) > EODHD (50) — use Psagot when session is active, fall back to EODHD.
   */
  readonly pricePriority?: number;

  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}
