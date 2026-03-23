import { describe, expect, it, vi } from 'vitest';
import type { HttpPort, HttpRequest, HttpResponse } from '../src/ports/HttpPort';
import { PsagotApiClient } from '../src/services/PsagotApiClient';

function mockHttp(handler: (req: HttpRequest) => HttpResponse): HttpPort {
  return { request: vi.fn(async (req: HttpRequest) => handler(req)) };
}

function rejectHttp(error: Error): HttpPort {
  return { request: vi.fn(async () => { throw error; }) };
}

const CREDS = { username: '123456789', password: 'secret' } as const;

describe('PsagotApiClient', () => {
  // ── Login Step 1: Initiate ──

  it('L1: successful step-1 login returns pending session with session key', async () => {
    const http = mockHttp(() => ({
      status: 200,
      body: { SessionKey: 'uuid-session-key-123' },
    }));
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);

    expect(pending.sessionKey).toBe('uuid-session-key-123');
    expect(pending.status).toBe('pending_otp');
    expect(pending.csession).toBeDefined();
  });

  it('L2: step-1 login with wrong password throws auth_failed error', async () => {
    const http = mockHttp(() => ({
      status: 401,
      body: { Error: 'Invalid credentials' },
    }));
    const client = new PsagotApiClient(http);

    await expect(client.initiateLogin(CREDS)).rejects.toMatchObject({
      type: 'auth_failed',
    });
  });

  it('L3: step-1 login network failure throws network_error', async () => {
    const http = rejectHttp(new Error('fetch failed'));
    const client = new PsagotApiClient(http);

    await expect(client.initiateLogin(CREDS)).rejects.toMatchObject({
      type: 'network_error',
    });
  });

  it('L4: step-1 sends correct headers and body', async () => {
    const http = mockHttp(() => ({
      status: 200,
      body: { SessionKey: 'abc' },
    }));
    const client = new PsagotApiClient(http);

    await client.initiateLogin(CREDS);

    const call = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as HttpRequest;
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/V2/json2/login');
    expect(call.url).toContain('catalog=unified');
    expect(call.headers?.csession).toBeDefined();
    expect(call.body).toMatchObject({
      username: '123456789',
      password: 'secret',
      Method: '2FA',
    });
  });

  // ── Login Step 2: OTP Verification ──

  it('O1: successful OTP verification returns authorized session', async () => {
    const http = mockHttp((req) => {
      const body = req.body as Record<string, string>;
      if (!body.Token) {
        return { status: 200, body: { SessionKey: 'pending-key' } };
      }
      return { status: 200, body: { SessionKey: 'authorized-key' } };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const authorized = await client.verifyOtp(pending, '123456', CREDS);

    expect(authorized.status).toBe('authorized');
    expect(authorized.sessionKey).toBe('authorized-key');
    expect(authorized.authorizedAt).toBeGreaterThan(0);
  });

  it('O2: wrong OTP code throws otp_invalid error', async () => {
    const http = mockHttp((req) => {
      const body = req.body as Record<string, string>;
      if (!body.Token) {
        return { status: 200, body: { SessionKey: 'pending-key' } };
      }
      return { status: 200, body: { Error: 'Invalid OTP', ErrorCode: 'OTP_INVALID' } };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    await expect(client.verifyOtp(pending, 'wrong', CREDS)).rejects.toMatchObject({
      type: 'otp_invalid',
    });
  });

  it('O3: OTP step sends correct body with Token', async () => {
    const http = mockHttp((req) => {
      const body = req.body as Record<string, string>;
      if (!body.Token) {
        return { status: 200, body: { SessionKey: 'pending-key' } };
      }
      return { status: 200, body: { SessionKey: 'auth-key' } };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    await client.verifyOtp(pending, '654321', CREDS);

    const calls = (http.request as ReturnType<typeof vi.fn>).mock.calls;
    const otpCall = calls[1][0] as HttpRequest;
    expect(otpCall.body).toMatchObject({
      username: '123456789',
      password: 'secret',
      Method: '2FA',
      Token: '654321',
    });
    expect(otpCall.headers?.session).toBe('pending-key');
  });

  // ── Session Management ──

  it('S1: session key included in data fetch headers', async () => {
    const http = mockHttp((req) => {
      if (req.method === 'POST') {
        const body = req.body as Record<string, string>;
        if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
        return { status: 200, body: { SessionKey: 'auth-key' } };
      }
      return { status: 200, body: [] };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const session = await client.verifyOtp(pending, '123', CREDS);
    await client.fetchAccounts(session);

    const calls = (http.request as ReturnType<typeof vi.fn>).mock.calls;
    const fetchCall = calls[2][0] as HttpRequest;
    expect(fetchCall.headers?.session).toBe('auth-key');
  });

  it('S2: session expiry mid-fetch throws session_expired error', async () => {
    let callCount = 0;
    const http = mockHttp((req) => {
      if (req.method === 'POST') {
        const body = req.body as Record<string, string>;
        if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
        return { status: 200, body: { SessionKey: 'auth-key' } };
      }
      callCount++;
      if (callCount === 1) {
        return { status: 200, body: { Error: 'InvalidSessionException' } };
      }
      return { status: 200, body: [] };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const session = await client.verifyOtp(pending, '123', CREDS);
    await expect(client.fetchAccounts(session)).rejects.toMatchObject({
      type: 'session_expired',
    });
  });

  it('S3: fetchAccounts before login throws api_error', async () => {
    const http = mockHttp(() => ({ status: 200, body: [] }));
    const client = new PsagotApiClient(http);

    const fakeSession = { sessionKey: '', csession: '', status: 'authorized' as const, authorizedAt: 0 };
    await expect(client.fetchAccounts(fakeSession)).rejects.toMatchObject({
      type: 'api_error',
    });
  });

  // ── Data Fetch: Accounts ──

  it('A1: fetchAccounts returns parsed account list', async () => {
    const http = mockHttp((req) => {
      if (req.method === 'POST') {
        const body = req.body as Record<string, string>;
        if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
        return { status: 200, body: { SessionKey: 'auth-key' } };
      }
      return {
        status: 200,
        body: [
          { '-key': '150-190500', AccountOwnerName: 'ישראל ישראלי', nickName: 'טווח קצר' },
          { '-key': '150-190501', AccountOwnerName: 'ישראל ישראלי', nickName: 'טווח ארוך' },
          { '-key': '150-190502', AccountOwnerName: 'ישראל ישראלי', nickName: '' },
        ],
      };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const session = await client.verifyOtp(pending, '123', CREDS);
    const accounts = await client.fetchAccounts(session);

    expect(accounts).toHaveLength(3);
    expect(accounts[0]).toEqual({ key: '150-190500', name: 'ישראל ישראלי', nickname: 'טווח קצר' });
    expect(accounts[1]).toEqual({ key: '150-190501', name: 'ישראל ישראלי', nickname: 'טווח ארוך' });
    expect(accounts[2]).toEqual({ key: '150-190502', name: 'ישראל ישראלי', nickname: '' });
  });

  it('A2: fetchAccounts with empty response returns empty array', async () => {
    const http = mockHttp((req) => {
      if (req.method === 'POST') {
        const body = req.body as Record<string, string>;
        if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
        return { status: 200, body: { SessionKey: 'auth-key' } };
      }
      return { status: 200, body: [] };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const session = await client.verifyOtp(pending, '123', CREDS);
    const accounts = await client.fetchAccounts(session);

    expect(accounts).toEqual([]);
  });

  // ── Data Fetch: Balances ──

  it('B1: fetchBalances returns parsed positions for account', async () => {
    const http = mockHttp((req) => {
      if (req.method === 'POST') {
        const body = req.body as Record<string, string>;
        if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
        return { status: 200, body: { SessionKey: 'auth-key' } };
      }
      if (req.url.includes('/balances')) {
        return {
          status: 200,
          body: {
            View: {
              Balance: [
                {
                  EquityNumber: '5130919',
                  OnlineNV: 100,
                  LastRate: 9741,
                  AveragePrice: 8500,
                  OnlineVL: 974100,
                  OnlineNisVL: 974100,
                  AveragePriceProfitLoss: 124100,
                  AveragePriceProfitLossNis: 124100,
                  AveragePriceProfitLossPercentage: 14.6,
                  OnlinePercentage: 45.2,
                  CurrencyCode: 'ILS',
                  Source: 'TA',
                  SubAccount: '0',
                },
              ],
              Meta: {
                Security: [
                  { EquityNumber: '5130919', hebName: 'בנק לאומי' },
                ],
              },
            },
          },
        };
      }
      return { status: 200, body: [] };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const session = await client.verifyOtp(pending, '123', CREDS);
    const balances = await client.fetchBalances(session, '150-190500');

    expect(balances).toHaveLength(1);
    expect(balances[0]).toEqual({
      equityNumber: '5130919',
      quantity: 100,
      lastRate: 9741,
      averagePrice: 8500,
      marketValue: 974100,
      marketValueNis: 974100,
      profitLoss: 124100,
      profitLossNis: 124100,
      profitLossPct: 14.6,
      portfolioWeight: 45.2,
      currencyCode: 'ILS',
      source: 'TA',
      subAccount: '0',
      hebName: 'בנק לאומי',
    });
  });

  it('B2: fetchBalances for account with no positions returns empty array', async () => {
    const http = mockHttp((req) => {
      if (req.method === 'POST') {
        const body = req.body as Record<string, string>;
        if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
        return { status: 200, body: { SessionKey: 'auth-key' } };
      }
      return {
        status: 200,
        body: { View: { Balance: [], Meta: { Security: [] } } },
      };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const session = await client.verifyOtp(pending, '123', CREDS);
    const balances = await client.fetchBalances(session, '150-190500');

    expect(balances).toEqual([]);
  });

  it('O4: verifyOtp response missing SessionKey throws api_error', async () => {
    const http = mockHttp((req) => {
      const body = req.body as Record<string, string>;
      if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
      // OTP step returns success body but no SessionKey
      return { status: 200, body: { SomeOtherField: 'value' } };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    await expect(client.verifyOtp(pending, '123456', CREDS)).rejects.toMatchObject({
      type: 'api_error',
    });
  });

  it('A3: fetchAccounts with non-array response returns empty array', async () => {
    const http = mockHttp((req) => {
      if (req.method === 'POST') {
        const body = req.body as Record<string, string>;
        if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
        return { status: 200, body: { SessionKey: 'auth-key' } };
      }
      // API returns object instead of array
      return { status: 200, body: { unexpected: 'object' } };
    });
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const session = await client.verifyOtp(pending, '123', CREDS);
    const accounts = await client.fetchAccounts(session);

    expect(accounts).toEqual([]);
  });

  it('B3: fetchBalances network failure throws network_error', async () => {
    let callCount = 0;
    const http: HttpPort = {
      request: vi.fn(async (req: HttpRequest) => {
        if (req.method === 'POST') {
          const body = req.body as Record<string, string>;
          if (!body.Token) return { status: 200, body: { SessionKey: 'pk' } };
          return { status: 200, body: { SessionKey: 'auth-key' } };
        }
        callCount++;
        if (callCount === 1) return { status: 200, body: [] }; // fetchAccounts succeeds
        throw new Error('Network timeout');
      }),
    };
    const client = new PsagotApiClient(http);

    const pending = await client.initiateLogin(CREDS);
    const session = await client.verifyOtp(pending, '123', CREDS);
    await client.fetchAccounts(session); // succeeds

    await expect(client.fetchBalances(session, '150-190500')).rejects.toMatchObject({
      type: 'network_error',
    });
  });
});
