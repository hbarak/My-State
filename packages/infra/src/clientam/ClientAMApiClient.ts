import type { HttpPort } from '@my-stocks/domain';
import type { IBAccount, IBPosition, IBApiError } from '@my-stocks/domain';

// ─────────────────────────────────────────────────────────────────────────────
// ClientAM (IB Israel) Portal API client
//
// ClientAM is IB Israel's white-label portal at clientam.com. It exposes the
// same IB Client Portal API under portal.proxy/v1/portal, but with differences:
//   - Accounts: GET /portfolio2/accounts (richer response, normalized to IBAccount)
//   - Positions: GET /portfolio2/{id}/positions (single call, no pagination)
//   - Auth: SSO cookies from browser session, no gateway login
//   - No tickle/keepalive needed
//   - No fetchMarketData needed (positions include mktPrice inline)
//
// This is a separate class from IBApiClient to keep the gateway code untouched.
// Both share the same domain types (IBAccount, IBPosition) and sync services.
// ─────────────────────────────────────────────────────────────────────────────

/** Raw account shape from ClientAM portfolio2/accounts endpoint */
interface ClientAMAccountRaw {
  readonly id?: string;
  readonly accountId?: string;
  readonly currency?: string;
  readonly type?: string;
  readonly displayName?: string;
  readonly accountTitle?: string;
  readonly desc?: string;
}

/** Raw position shape from ClientAM portfolio2/{id}/positions endpoint */
interface ClientAMPositionRaw {
  readonly acctId: string;
  readonly conid: number;
  readonly contractDesc: string;
  readonly description?: string;
  readonly position: number;
  readonly mktPrice: number;
  readonly mktValue: number;
  readonly marketPrice?: number;
  readonly marketValue?: number;
  readonly avgCost: number;
  readonly avgPrice: number;
  readonly unrealizedPnl: number;
  readonly currency: string;
  readonly assetClass?: string;
  readonly secType?: string;
  readonly ticker?: string;
  readonly fullName?: string;
  readonly isin?: string;
  readonly listingExchange?: string;
}

function clientamError(
  type: IBApiError['type'],
  message: string,
  extra?: { cause?: Error; statusCode?: number },
): IBApiError {
  return { type, message, ...extra } as IBApiError;
}

export class ClientAMApiClient {
  constructor(
    private readonly http: HttpPort,
    private readonly baseUrl: string,
  ) {}

  /**
   * Check if the ClientAM session cookies are still valid.
   *
   * Unlike the IB gateway which has /iserver/auth/status, ClientAM's auth/status
   * returns authenticated: false even with valid cookies. Instead, we validate
   * by calling the actual data endpoint (portfolio2/accounts).
   */
  async checkSession(): Promise<{ authenticated: boolean }> {
    try {
      const res = await this.http.request({
        method: 'GET',
        url: `${this.baseUrl}/portfolio2/accounts`,
      });

      if (res.status === 401 || res.status === 403) {
        return { authenticated: false };
      }

      const body = res.body as ClientAMAccountRaw[] | null;
      if (!Array.isArray(body) || body.length === 0) {
        return { authenticated: false };
      }

      return { authenticated: true };
    } catch {
      return { authenticated: false };
    }
  }

  /**
   * Fetch accounts from ClientAM and normalize to IBAccount shape.
   */
  async fetchAccounts(): Promise<IBAccount[]> {
    const res = await this.http.request({
      method: 'GET',
      url: `${this.baseUrl}/portfolio2/accounts`,
    });

    if (res.status === 401 || res.status === 403) {
      throw clientamError('not_authenticated', 'ClientAM session expired or invalid');
    }
    if (res.status >= 400) {
      throw clientamError('api_error', `fetchAccounts failed: HTTP ${res.status}`, { statusCode: res.status });
    }

    const raw = (res.body as ClientAMAccountRaw[]) ?? [];
    return raw.map(normalizeAccount);
  }

  /**
   * Fetch all positions for an account in a single call.
   *
   * ClientAM's portfolio2 endpoint returns all positions at once (no pagination).
   */
  async fetchPositions(accountId: string): Promise<IBPosition[]> {
    const res = await this.http.request({
      method: 'GET',
      url: `${this.baseUrl}/portfolio2/${encodeURIComponent(accountId)}/positions?sort=marketValue&direction=d`,
    });

    if (res.status === 401 || res.status === 403) {
      throw clientamError('not_authenticated', 'ClientAM session expired or invalid');
    }
    if (res.status >= 400) {
      throw clientamError('api_error', `fetchPositions failed: HTTP ${res.status}`, { statusCode: res.status });
    }

    const raw = (res.body as ClientAMPositionRaw[]) ?? [];
    return raw.map(normalizePosition);
  }
}

function normalizeAccount(raw: ClientAMAccountRaw): IBAccount {
  return {
    id: raw.id ?? raw.accountId ?? '',
    currency: raw.currency ?? 'USD',
    type: raw.type ?? 'INDIVIDUAL',
    desc: raw.displayName ?? raw.accountTitle ?? raw.desc,
  };
}

function normalizePosition(raw: ClientAMPositionRaw): IBPosition {
  return {
    acctId: raw.acctId,
    conid: raw.conid,
    contractDesc: raw.contractDesc,
    position: raw.position,
    mktPrice: raw.mktPrice ?? raw.marketPrice ?? 0,
    mktValue: raw.mktValue ?? raw.marketValue ?? 0,
    avgCost: raw.avgCost,
    avgPrice: raw.avgPrice,
    unrealizedPnl: raw.unrealizedPnl,
    currency: raw.currency,
    assetClass: raw.assetClass ?? raw.secType ?? 'STK',
    ticker: raw.ticker ?? raw.description,
    fullName: raw.fullName,
    isin: raw.isin,
    listingExchange: raw.listingExchange,
  };
}
