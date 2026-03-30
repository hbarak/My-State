import type { HttpPort } from '../ports/HttpPort';
import type {
  PsagotAccount,
  PsagotAuthorizedSession,
  PsagotBalance,
  PsagotCredentials,
  PsagotPendingSession,
} from '../types';

const DEFAULT_BASE_URL = 'https://trade1.psagot.co.il';
const LOGIN_PATH = '/V2/json2/login?catalog=unified';
const ACCOUNTS_PATH = '/V2/json/accounts?catalog=unified';
const BALANCES_PATH = '/V2/json2/account/view/balances';
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
      return [];
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

    const body = response as Record<string, unknown>;

    // Response may or may not be wrapped in "View":
    //   { View: { Account: {...}, Meta: {...} } }   — accounts 150-224990, 150-235237
    //   { Account: {...}, Meta: {...} }              — account 150-190500
    const view = (body.View ?? body) as Record<string, unknown>;
    const account = view.Account as Record<string, unknown> | undefined;
    if (!account) return [];

    // Balances are nested: Account.AccountPosition.Balance[]
    const accountPosition = account.AccountPosition as Record<string, unknown> | undefined;
    const rawBalances = (accountPosition?.Balance ?? []) as Record<string, unknown>[];

    // Security names in Meta use "-Key" (dash prefix), not "EquityNumber"
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
