import type { HttpPort } from '@my-stocks/domain';
import type {
  IBAuthStatus,
  IBAccount,
  IBPosition,
  IBMarketDataSnapshot,
  IBTickleResponse,
  IBApiError,
} from '@my-stocks/domain';

// ─────────────────────────────────────────────────────────────────────────────
// IB Client Portal Gateway REST API client
//
// The gateway runs locally (Docker or Java JAR) at a configurable base URL
// (default: /api/ib which the BFF proxies to https://localhost:5000/v1/api).
//
// Auth is browser-based — the user logs in at the gateway's web UI.
// We never handle credentials here; we only check session status.
//
// Market data snapshot requires two calls (pre-flight + actual data).
// Positions are paginated (page 0, 1, ... until empty array).
// ─────────────────────────────────────────────────────────────────────────────

const MARKET_DATA_FIELDS = '31,84,86,55,7221'; // last, bid, ask, symbol, contract desc
const MAX_CONIDS_PER_BATCH = 100;
const PREFLIGHT_DELAY_MS = 500;

function ibError(
  type: IBApiError['type'],
  message: string,
  extra?: { cause?: Error; statusCode?: number },
): IBApiError {
  return { type, message, ...extra } as IBApiError;
}

export class IBApiClient {
  constructor(
    private readonly http: HttpPort,
    private readonly baseUrl: string,
  ) {}

  /**
   * Check if the gateway has an active authenticated session.
   * Throws IBApiError if the gateway is unreachable or session is invalid.
   */
  async checkAuthStatus(): Promise<IBAuthStatus> {
    try {
      const res = await this.http.request({
        method: 'GET',
        url: `${this.baseUrl}/iserver/auth/status`,
      });

      if (res.status === 401) {
        throw ibError('not_authenticated', 'IB gateway session not authenticated');
      }
      if (res.status >= 400) {
        throw ibError('api_error', `IB auth status check failed: HTTP ${res.status}`, { statusCode: res.status });
      }

      return res.body as IBAuthStatus;
    } catch (err) {
      if ((err as IBApiError).type) throw err;
      throw ibError('gateway_unavailable', 'IB Client Portal Gateway is not reachable. Is it running?', {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  /**
   * Send a keepalive tickle to prevent session timeout.
   * Must be called every ~55s. The gateway session expires after ~10min of inactivity.
   */
  async tickle(): Promise<IBTickleResponse> {
    try {
      const res = await this.http.request({
        method: 'POST',
        url: `${this.baseUrl}/tickle`,
      });

      if (res.status >= 400) {
        throw ibError('api_error', `Tickle failed: HTTP ${res.status}`, { statusCode: res.status });
      }

      return res.body as IBTickleResponse;
    } catch (err) {
      if ((err as IBApiError).type) throw err;
      throw ibError('gateway_unavailable', 'IB gateway tickle failed', {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  /**
   * Fetch the list of IB accounts for the authenticated user.
   */
  async fetchAccounts(): Promise<IBAccount[]> {
    try {
      const res = await this.http.request({
        method: 'GET',
        url: `${this.baseUrl}/portfolio/accounts`,
      });

      if (res.status === 401) {
        throw ibError('not_authenticated', 'IB session not authenticated');
      }
      if (res.status >= 400) {
        throw ibError('api_error', `fetchAccounts failed: HTTP ${res.status}`, { statusCode: res.status });
      }

      return (res.body as IBAccount[]) ?? [];
    } catch (err) {
      if ((err as IBApiError).type) throw err;
      throw ibError('gateway_unavailable', 'Failed to fetch IB accounts', {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  /**
   * Fetch all positions for an account. Handles pagination automatically —
   * fetches page 0, 1, etc. until an empty array is returned.
   */
  async fetchPositions(accountId: string): Promise<IBPosition[]> {
    const all: IBPosition[] = [];
    let page = 0;

    while (true) {
      const res = await this.http.request({
        method: 'GET',
        url: `${this.baseUrl}/portfolio/${encodeURIComponent(accountId)}/positions/${page}`,
      });

      if (res.status === 401) {
        throw ibError('not_authenticated', 'IB session not authenticated');
      }
      if (res.status >= 400) {
        throw ibError('api_error', `fetchPositions page ${page} failed: HTTP ${res.status}`, { statusCode: res.status });
      }

      const positions = (res.body as IBPosition[]) ?? [];
      if (positions.length === 0) break;

      all.push(...positions);
      page++;
    }

    return all;
  }

  /**
   * Fetch market data snapshots for a list of conids.
   *
   * IB's snapshot endpoint requires a "pre-flight" — the first call warms up
   * the subscription, the second call returns the actual data.
   * Batches in groups of 100 (IB limit).
   */
  async fetchMarketData(conids: readonly number[]): Promise<IBMarketDataSnapshot[]> {
    if (conids.length === 0) return [];

    const results: IBMarketDataSnapshot[] = [];

    // Process in batches of MAX_CONIDS_PER_BATCH
    for (let i = 0; i < conids.length; i += MAX_CONIDS_PER_BATCH) {
      const batch = conids.slice(i, i + MAX_CONIDS_PER_BATCH);
      const batchResults = await this.fetchMarketDataBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async fetchMarketDataBatch(conids: readonly number[]): Promise<IBMarketDataSnapshot[]> {
    const conidParam = conids.join(',');
    const url = `${this.baseUrl}/iserver/marketdata/snapshot?conids=${conidParam}&fields=${MARKET_DATA_FIELDS}`;

    // Pre-flight call — warms up the subscription
    await this.http.request({ method: 'GET', url });

    // Wait briefly for IB to populate the snapshot
    await delay(PREFLIGHT_DELAY_MS);

    // Actual data call
    const res = await this.http.request({ method: 'GET', url });

    if (res.status === 401) {
      throw ibError('not_authenticated', 'IB session not authenticated during market data fetch');
    }
    if (res.status >= 400) {
      throw ibError('api_error', `fetchMarketData failed: HTTP ${res.status}`, { statusCode: res.status });
    }

    return (res.body as IBMarketDataSnapshot[]) ?? [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
