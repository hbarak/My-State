import type { HttpPort } from '../ports/HttpPort';
import type {
  PsagotAccount,
  PsagotAuthorizedSession,
  PsagotBalance,
  PsagotCredentials,
  PsagotPendingSession,
} from '../types';

const BASE_URL = 'https://trade1.psagot.co.il';
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
  constructor(private readonly http: HttpPort) {}

  async initiateLogin(credentials: PsagotCredentials): Promise<PsagotPendingSession> {
    const csession = generateCsession();

    let response;
    try {
      response = await this.http.request({
        method: 'POST',
        url: `${BASE_URL}${LOGIN_PATH}`,
        headers: {
          csession,
          'Content-Type': 'application/json',
        },
        body: {
          username: credentials.username,
          password: credentials.password,
          Method: '2FA',
        },
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      throw apiError('network_error', 'Network error during login', {
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw apiError('auth_failed', 'Login failed. Check your credentials.');
    }

    const body = response.body as Record<string, unknown>;

    if (body.Error) {
      throw apiError('auth_failed', String(body.Error));
    }

    const sessionKey = body.SessionKey as string;
    if (!sessionKey) {
      throw apiError('api_error', 'No session key in login response');
    }

    return {
      sessionKey,
      csession,
      status: 'pending_otp',
    };
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
        url: `${BASE_URL}${LOGIN_PATH}`,
        headers: {
          csession: pending.csession,
          session: pending.sessionKey,
          'Content-Type': 'application/json',
        },
        body: {
          username: credentials.username,
          password: credentials.password,
          Method: '2FA',
          Token: otpCode,
        },
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) {
      throw apiError('network_error', 'Network error during OTP verification', {
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw apiError('auth_failed', 'Login failed. Check your credentials.');
    }

    const body = response.body as Record<string, unknown>;

    if (body.Error) {
      const errorStr = String(body.Error);
      if (errorStr.includes('OTP') || body.ErrorCode === 'OTP_INVALID') {
        throw apiError('otp_invalid', 'Invalid OTP code. Please try again.');
      }
      if (errorStr.includes('expired')) {
        throw apiError('otp_expired', 'OTP expired. Starting over.');
      }
      throw apiError('auth_failed', errorStr);
    }

    const sessionKey = body.SessionKey as string;
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
      `${BASE_URL}${ACCOUNTS_PATH}`,
      session,
    );

    const body = response as unknown[];
    if (!Array.isArray(body)) {
      return [];
    }

    return body.map((item) => {
      const raw = item as Record<string, string>;
      return {
        key: raw['-key'] ?? '',
        name: raw.AccountOwnerName ?? '',
        nickname: raw.nickName ?? '',
      };
    });
  }

  async fetchBalances(session: PsagotAuthorizedSession, accountId: string): Promise<PsagotBalance[]> {
    this.assertValidSession(session);

    const url = `${BASE_URL}${BALANCES_PATH}?account=${encodeURIComponent(accountId)}&fields=hebName&currency=ils&catalog=unified`;
    const response = await this.authenticatedGet(url, session);

    const body = response as Record<string, unknown>;
    const view = body?.View as Record<string, unknown> | undefined;
    if (!view) return [];

    const rawBalances = (view.Balance ?? []) as Record<string, unknown>[];
    const meta = view.Meta as Record<string, unknown> | undefined;
    const securities = (meta?.Security ?? []) as Record<string, unknown>[];

    const securityNameMap = new Map<string, string>();
    for (const sec of securities) {
      const eqNum = String(sec.EquityNumber ?? '');
      const name = sec.hebName as string | null;
      if (eqNum && name) {
        securityNameMap.set(eqNum, name);
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
