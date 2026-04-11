import type { HttpPort } from '@my-stocks/domain';
import type {
  PsagotAccount,
  PsagotAuthorizedSession,
  PsagotBalance,
  PsagotCredentials,
  PsagotMarketRate,
  PsagotPendingSession,
  PsagotSecurityInfo,
} from '@my-stocks/domain';

const DEFAULT_BASE_URL = 'https://trade1.psagot.co.il';
const LOGIN_PATH = '/V2/json2/login?catalog=unified';
const ACCOUNTS_PATH = '/V2/json/accounts?catalog=unified';
const BALANCES_PATH = '/V2/json2/account/view/balances';
const SECURITY_INFO_PATH = '/V2/json2/market/table/simple';
const SECURITY_INFO_FIELDS = 'HebName,EngName,EngSymbol,Exchange,CurrencyCode,CurrencyDivider,IsForeign,ItemType';
const MARKET_RATE_FIELDS = 'BaseRate,CurrencyCode,CurrencyDivider,LastKnownRateDate';
const DEFAULT_TIMEOUT_MS = 30_000;

interface PsagotApiErrorObject {
  readonly type: 'auth_failed' | 'otp_invalid' | 'otp_expired' | 'session_expired' | 'network_error' | 'api_error';
  readonly message: string;
  readonly cause?: Error;
  readonly statusCode?: number;
}

function apiError(type: PsagotApiErrorObject['type'], message: string, extra?: { cause?: Error; statusCode?: number }): PsagotApiErrorObject {
  return { type, message, ...extra };
}

function generateCsession(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface UnwrappedBalanceResponse {
  readonly rawBalances: Record<string, unknown>[];
  readonly securityNameMap: Map<string, string>;
}

/**
 * Handles the two structural variants of the Psagot balances response:
 *   { View: { Account: {...}, Meta: {...} } }  — most accounts
 *   { Account: {...}, Meta: {...} }             — some accounts (no View wrapper)
 *
 * Throws a typed api_error if the Account field is missing, so callers can
 * distinguish "no positions" from "response shape changed."
 */
function unwrapBalanceResponse(response: unknown): UnwrappedBalanceResponse {
  const body = response as Record<string, unknown>;
  const view = (body.View ?? body) as Record<string, unknown>;
  const account = view.Account as Record<string, unknown> | undefined;
  if (!account) {
    throw apiError('api_error', 'Unexpected balances response shape — Account missing');
  }

  const accountPosition = account.AccountPosition as Record<string, unknown> | undefined;
  const balanceRaw = accountPosition?.Balance ?? [];
  if (!Array.isArray(balanceRaw)) {
    throw apiError('api_error', 'Unexpected balances response shape — Balance is not an array');
  }
  const rawBalances = balanceRaw as Record<string, unknown>[];

  const meta = view.Meta as Record<string, unknown> | undefined;
  const securities = (meta?.Security ?? []) as Record<string, unknown>[];

  const securityNameMap = new Map<string, string>();
  for (const sec of securities) {
    const key = String(sec['-Key'] ?? sec.EquityNumber ?? '');
    const name = sec.hebName as string | null;
    if (key && name) {
      securityNameMap.set(key, name);
    }
  }

  return { rawBalances, securityNameMap };
}

export class PsagotApiClient {
  private readonly baseUrl: string;

  constructor(private readonly http: HttpPort, baseUrl?: string) {
    this.baseUrl = baseUrl ?? DEFAULT_BASE_URL;
  }

  async initiateLogin(credentials: PsagotCredentials): Promise<PsagotPendingSession> {
    const csession = generateCsession();

    let response;
    try {
      response = await this.http.request({
        method: 'POST',
        url: `${this.baseUrl}${LOGIN_PATH}`,
        headers: {
          csession,
          'Content-Type': 'application/json',
        },
        body: {
          Login: {
            '-Product': 'Android',
            User: credentials.username,
            Password: credentials.password,
            Method: '2FA',
          },
        },
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      throw apiError('network_error', 'Network error during login', {
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }

    const body = response.body as Record<string, unknown>;
    const exception = body.Exception as Record<string, string> | undefined;

    // MFATokenMissingException = success: credentials accepted, SMS OTP sent
    if (exception?.['-ExceptionType'] === 'MFATokenMissingException') {
      return { csession, status: 'pending_otp' };
    }

    // Any other exception or non-401 error is a real failure
    if (exception) {
      throw apiError('auth_failed', exception.Message ?? 'Login failed. Check your credentials.');
    }

    if (response.status === 401 || response.status === 403) {
      throw apiError('auth_failed', 'Login failed. Check your credentials.');
    }

    // Unexpected success without MFA challenge — treat as pending anyway
    return { csession, status: 'pending_otp' };
  }

  async verifyOtp(
    pending: PsagotPendingSession,
    otpCode: string,
    credentials: PsagotCredentials,
  ): Promise<PsagotAuthorizedSession> {
    let response;
    try {
      response = await this.http.request({
        method: 'POST',
        url: `${this.baseUrl}${LOGIN_PATH}`,
        headers: {
          csession: pending.csession,
          'Content-Type': 'application/json',
        },
        body: {
          Login: {
            '-Product': 'Android',
            User: credentials.username,
            Password: credentials.password,
            Method: '2FA',
            Token: otpCode,
          },
        },
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      throw apiError('network_error', 'Network error during OTP verification', {
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }

    const body = response.body as Record<string, unknown>;
    const exception = body.Exception as Record<string, string> | undefined;

    if (exception) {
      const exType = exception['-ExceptionType'] ?? '';
      const message = exception.Message ?? '';

      // Check expired before invalid — "Token has expired" contains both keywords
      if (message.toLowerCase().includes('expired') || exType.includes('Expired')) {
        throw apiError('otp_expired', 'OTP expired. Starting over.');
      }
      if (exType.includes('MFAToken') || message.includes('OTP') || message.includes('Token')) {
        throw apiError('otp_invalid', 'Invalid OTP code. Please try again.');
      }
      throw apiError('auth_failed', message || 'Login failed. Check your credentials.');
    }

    if (response.status === 401 || response.status === 403) {
      throw apiError('auth_failed', 'Login failed. Check your credentials.');
    }

    // SessionKey is inside the WCF Login wrapper: { Login: { SessionKey: "..." } }
    const login = body.Login as Record<string, unknown> | undefined;
    const sessionKey = (login?.SessionKey ?? body.SessionKey) as string | undefined;
    if (!sessionKey) {
      throw apiError('api_error', 'No session key in OTP response');
    }

    return {
      sessionKey,
      csession: pending.csession,
      status: 'authorized',
      authorizedAt: Date.now(),
    };
  }

  async fetchAccounts(session: PsagotAuthorizedSession): Promise<PsagotAccount[]> {
    this.assertValidSession(session);

    const response = await this.authenticatedGet(
      `${this.baseUrl}${ACCOUNTS_PATH}`,
      session,
    );

    // Response is WCF double-wrapped: { UserAccounts: { UserAccount: [...] } }
    const body = response as Record<string, unknown>;
    const wrapper = body.UserAccounts as Record<string, unknown> | undefined;
    const accounts = (wrapper?.UserAccount ?? body.UserAccount ?? body) as unknown[];
    if (!Array.isArray(accounts)) {
      throw apiError('api_error', 'Unexpected accounts response shape — UserAccounts missing or not an array');
    }

    return accounts.map((item) => {
      const raw = item as Record<string, string>;
      return {
        key: raw['-key'] ?? '',
        name: raw['-name'] ?? raw.AccountOwnerName ?? '',
        nickname: raw['-nickName'] ?? raw.nickName ?? '',
      };
    });
  }

  async fetchBalances(session: PsagotAuthorizedSession, accountId: string): Promise<PsagotBalance[]> {
    this.assertValidSession(session);

    const url = `${this.baseUrl}${BALANCES_PATH}?account=${encodeURIComponent(accountId)}&fields=hebName&currency=ils&catalog=unified`;
    const response = await this.authenticatedGet(url, session);

    const { rawBalances, securityNameMap } = unwrapBalanceResponse(response);

    return rawBalances.map((b) => {
      const equityNumber = String(b.EquityNumber ?? '');
      return {
        equityNumber,
        quantity: Number(b.OnlineNV ?? 0),
        lastRate: Number(b.LastRate ?? 0),
        averagePrice: Number(b.AveragePrice ?? 0),
        marketValue: Number(b.OnlineVL ?? 0),
        marketValueNis: Number(b.OnlineNisVL ?? 0),
        profitLoss: Number(b.AveragePriceProfitLoss ?? 0),
        profitLossNis: Number(b.AveragePriceProfitLossNis ?? 0),
        profitLossPct: Number(b.AveragePriceProfitLossPercentage ?? 0),
        portfolioWeight: Number(b.OnlinePercentage ?? 0),
        currencyCode: String(b.CurrencyCode ?? ''),
        source: String(b.Source ?? ''),
        subAccount: String(b.SubAccount ?? ''),
        hebName: securityNameMap.get(equityNumber) ?? null,
      };
    });
  }

  async fetchSecurityInfo(
    session: PsagotAuthorizedSession,
    equityNumbers: readonly string[],
  ): Promise<PsagotSecurityInfo[]> {
    if (equityNumbers.length === 0) return [];
    this.assertValidSession(session);

    const securities = equityNumbers.map(encodeURIComponent).join('%2C');
    const url = `${this.baseUrl}${SECURITY_INFO_PATH}?securities=${securities}&fields=${SECURITY_INFO_FIELDS}&catalog=unified`;
    const response = await this.authenticatedGet(url, session);

    const body = response as Record<string, unknown>;
    const table = body.Table as Record<string, unknown> | undefined;
    const raw = (table?.Security ?? []) as Record<string, unknown>[];
    if (!Array.isArray(raw)) return [];

    return raw.map((sec) => ({
      equityNumber: String(sec['-Key'] ?? ''),
      hebName: (sec.HebName as string | null) ?? null,
      engName: (sec.EngName as string | null) ?? null,
      engSymbol: (sec.EngSymbol as string | null) ?? null,
      exchange: (sec.Exchange as string | null) ?? null,
      currencyCode: (sec.CurrencyCode as string | null) ?? null,
      currencyDivider: typeof sec.CurrencyDivider === 'number' ? sec.CurrencyDivider : 1,
      isForeign: Boolean(sec.IsForeign),
      itemType: (sec.ItemType as string | null) ?? null,
    }));
  }

  /**
   * Fetches real-time price snapshots for the given equity numbers.
   * Uses the market/table/simple endpoint with BaseRate + LastKnownRateDate fields.
   * More efficient than fetchBalances() for price-only refreshes: one request,
   * no per-account iteration, no rate limiting delays.
   *
   * BaseRate is in the security's native unit — apply currencyDivider to normalize
   * (e.g. divide by 100 for TASE funds quoted in agorot).
   */
  async fetchMarketRates(
    session: PsagotAuthorizedSession,
    equityNumbers: readonly string[],
  ): Promise<PsagotMarketRate[]> {
    if (equityNumbers.length === 0) return [];
    this.assertValidSession(session);

    const securities = equityNumbers.map(encodeURIComponent).join('%2C');
    const url = `${this.baseUrl}${SECURITY_INFO_PATH}?securities=${securities}&fields=${MARKET_RATE_FIELDS}&catalog=unified`;
    const response = await this.authenticatedGet(url, session);

    const body = response as Record<string, unknown>;
    const table = body.Table as Record<string, unknown> | undefined;
    const raw = (table?.Security ?? []) as Record<string, unknown>[];
    if (!Array.isArray(raw)) return [];

    return raw.map((sec): PsagotMarketRate => ({
      equityNumber: String(sec['-Key'] ?? ''),
      baseRate: typeof sec.BaseRate === 'number' ? sec.BaseRate : 0,
      currencyCode: typeof sec.CurrencyCode === 'string' ? sec.CurrencyCode : 'ILS',
      currencyDivider: typeof sec.CurrencyDivider === 'number' ? sec.CurrencyDivider : 1,
      lastKnownRateDate: typeof sec.LastKnownRateDate === 'string' ? sec.LastKnownRateDate : new Date().toISOString(),
    }));
  }

  private assertValidSession(session: PsagotAuthorizedSession): void {
    if (!session.sessionKey || session.status !== 'authorized') {
      throw apiError('api_error', 'Not authenticated. Call initiateLogin and verifyOtp first.');
    }
  }

  private async authenticatedGet(
    url: string,
    session: PsagotAuthorizedSession,
  ): Promise<unknown> {
    let response;
    try {
      response = await this.http.request({
        method: 'GET',
        url,
        headers: {
          session: session.sessionKey,
          csession: session.csession,
        },
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      throw apiError('network_error', 'Network error during data fetch', {
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }

    const body = response.body as Record<string, unknown>;

    if (typeof body === 'object' && body !== null && 'Error' in body) {
      const errorStr = String(body.Error);
      if (errorStr.includes('InvalidSessionException')) {
        throw apiError('session_expired', 'Session expired during sync. Starting over.');
      }
      throw apiError('api_error', errorStr, { statusCode: response.status });
    }

    return body;
  }
}
