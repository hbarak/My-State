// ─────────────────────────────────────────────────────────────────────────────
// Interactive Brokers Client Portal API types
//
// Modeled from IB Client Portal Gateway REST API responses.
// The gateway runs locally (Docker or JAR) and proxies to IB servers.
// Auth is browser-based (user logs in at gateway UI); we only consume the API.
//
// Reference: https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response from GET /iserver/auth/status
 * Indicates whether the gateway has an active, authenticated session.
 */
export interface IBAuthStatus {
  /** True if the gateway has a valid brokerage session */
  readonly authenticated: boolean;
  /** True if another session (e.g. TWS) is competing for the same username */
  readonly competing: boolean;
  /** True if the gateway is connected to IB servers */
  readonly connected: boolean;
  /** Optional message from IB (e.g. "Login required") */
  readonly message?: string;
  /** Fail reason if authentication failed */
  readonly fail?: string;
}

/**
 * Response from POST /tickle — session keepalive.
 * Must be called every ~55s or the session expires after ~10min.
 */
export interface IBTickleResponse {
  /** Current session ID */
  readonly session: string;
  /** SSO expiration timestamp (epoch ms) */
  readonly ssoExpires: number;
  /** Collission flag — same as competing in auth status */
  readonly collission: boolean;
  /** User ID */
  readonly userId: number;
  /** Whether the session is still valid */
  readonly iserver: {
    readonly authStatus: {
      readonly authenticated: boolean;
      readonly competing: boolean;
      readonly connected: boolean;
    };
  };
}

/**
 * A single IB account from GET /portfolio/accounts.
 */
export interface IBAccount {
  /** Account ID, e.g. "U10807583" */
  readonly id: string;
  /** Account currency */
  readonly currency: string;
  /** Account type: "INDIVIDUAL", "JOINT", etc. */
  readonly type: string;
  /** Display name */
  readonly desc?: string;
}

/**
 * A single position from GET /portfolio/{accountId}/positions/{pageId}.
 *
 * IB returns positions as an array; empty array means no more pages.
 * Fields come from the raw IB response — names match the API exactly.
 */
export interface IBPosition {
  /** Account ID, e.g. "U10807583" */
  readonly acctId: string;
  /** IB contract ID — the unique security identifier in IB's system */
  readonly conid: number;
  /** Human-readable contract description, e.g. "AAPL (NASDAQ)" */
  readonly contractDesc: string;
  /** Position quantity (negative = short) */
  readonly position: number;
  /** Current market price */
  readonly mktPrice: number;
  /** Current market value (position × mktPrice) */
  readonly mktValue: number;
  /** Average cost basis per unit */
  readonly avgCost: number;
  /** Avg cost in account base currency */
  readonly avgPrice: number;
  /** Unrealized P&L */
  readonly unrealizedPnl: number;
  /** Currency of the position */
  readonly currency: string;
  /** Asset class: "STK", "OPT", "FUT", "BOND", "CASH", etc. */
  readonly assetClass: string;
  /** Ticker symbol if available */
  readonly ticker?: string;
  /** Full name of the security */
  readonly fullName?: string;
  /** ISIN if available */
  readonly isin?: string;
  /** Listing exchange */
  readonly listingExchange?: string;
}

/**
 * A single market data snapshot from GET /iserver/marketdata/snapshot.
 *
 * Field keys are numeric strings — IB uses field codes, not named keys.
 * Common fields:
 *   31  = last price
 *   84  = bid price
 *   86  = ask price
 *   85  = bid size
 *   88  = ask size
 *   7059 = last size
 *   7295 = open price
 *   7296 = close price
 *   55  = symbol
 *   7221 = contract description
 */
export interface IBMarketDataSnapshot {
  readonly conid: number;
  /** Last price (string — IB returns numbers as strings in snapshots) */
  readonly '31'?: string;
  /** Bid price */
  readonly '84'?: string;
  /** Ask price */
  readonly '86'?: string;
  /** Bid size */
  readonly '85'?: string;
  /** Ask size */
  readonly '88'?: string;
  /** Last size */
  readonly '7059'?: string;
  /** Open price */
  readonly '7295'?: string;
  /** Close price */
  readonly '7296'?: string;
  /** Symbol */
  readonly '55'?: string;
  /** Contract description */
  readonly '7221'?: string;
}

/**
 * Typed error for IB API operations.
 */
export type IBApiError =
  | { readonly type: 'not_authenticated'; readonly message: string }
  | { readonly type: 'competing_session'; readonly message: string }
  | { readonly type: 'gateway_unavailable'; readonly message: string }
  | { readonly type: 'network_error'; readonly message: string; readonly cause?: Error }
  | { readonly type: 'api_error'; readonly message: string; readonly statusCode?: number };
