import { describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * Integration test: start a minimal HTTP server that replicates how Vite mounts
 * the mock plugin middleware, then assert all active Psagot API endpoints
 * respond with the expected fixture shape.
 */

type NextFn = () => void;
type MiddlewareFn = (req: IncomingMessage, res: ServerResponse, next: NextFn) => void;

async function importMockHandler(): Promise<MiddlewareFn> {
  // Dynamically import the plugin and extract its request handler
  const { psagotMockPlugin } = await import('../psagot-mock-plugin');
  const plugin = psagotMockPlugin();

  let capturedHandler: MiddlewareFn | null = null;

  const fakeServer = {
    middlewares: {
      use(_prefix: string, handler: MiddlewareFn) {
        capturedHandler = handler;
      },
    },
  };

  (plugin.configureServer as (s: unknown) => void)(fakeServer);

  if (!capturedHandler) throw new Error('Mock plugin did not register a handler');
  return capturedHandler;
}

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const handler = await importMockHandler();
  const PROXY_PREFIX = '/api/psagot';

  const server = createServer((req, res) => {
    // Strip prefix from URL to match how Vite mounts sub-path middleware
    if (req.url?.startsWith(PROXY_PREFIX)) {
      req.url = req.url.slice(PROXY_PREFIX.length) || '/';
    }
    handler(req, res, () => {
      res.writeHead(404);
      res.end('not found');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/api/psagot`,
        close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

async function postJson(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function getJson(url: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url);
  return { status: res.status, json: await res.json() };
}

describe('psagotMockPlugin — integration', () => {
  it('POST /V2/json2/login without Token → MFATokenMissingException (pending OTP)', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { status, json } = await postJson(
        `${baseUrl}/V2/json2/login?catalog=unified`,
        { Login: { User: 'test', Password: 'test', Method: '2FA' } },
      );
      expect(status).toBe(200);
      const body = json as Record<string, unknown>;
      const ex = body.Exception as Record<string, string>;
      expect(ex['-ExceptionType']).toBe('MFATokenMissingException');
    } finally {
      await close();
    }
  });

  it('POST /V2/json2/login with 6-digit Token → authorized session with SessionKey', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { status, json } = await postJson(
        `${baseUrl}/V2/json2/login?catalog=unified`,
        { Login: { User: 'test', Password: 'test', Method: '2FA', Token: '123456' } },
      );
      expect(status).toBe(200);
      const body = json as Record<string, unknown>;
      const login = body.Login as Record<string, string>;
      expect(typeof login.SessionKey).toBe('string');
      expect(login.SessionKey.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('GET /V2/json/accounts → UserAccounts with UserAccount array', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { status, json } = await getJson(`${baseUrl}/V2/json/accounts?catalog=unified`);
      expect(status).toBe(200);
      const body = json as Record<string, unknown>;
      const wrapper = body.UserAccounts as Record<string, unknown>;
      expect(Array.isArray(wrapper.UserAccount)).toBe(true);
      const accounts = wrapper.UserAccount as Record<string, string>[];
      expect(accounts.length).toBeGreaterThan(0);
      expect(typeof accounts[0]['-key']).toBe('string');
    } finally {
      await close();
    }
  });

  it('GET /V2/json2/account/view/balances?account=150-190500 → Balance array with positions', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { status, json } = await getJson(
        `${baseUrl}/V2/json2/account/view/balances?account=150-190500&fields=hebName&currency=ils&catalog=unified`,
      );
      expect(status).toBe(200);
      const body = json as Record<string, unknown>;
      const view = body.View as Record<string, unknown>;
      const account = view.Account as Record<string, unknown>;
      const accountPos = account.AccountPosition as Record<string, unknown>;
      expect(Array.isArray(accountPos.Balance)).toBe(true);
      const balances = accountPos.Balance as Record<string, unknown>[];
      expect(balances.length).toBeGreaterThan(0);
      expect(typeof balances[0].EquityNumber).toBe('string');
      expect(typeof balances[0].OnlineNV).toBe('number');
    } finally {
      await close();
    }
  });

  it('GET /V2/json2/account/view/balances for unknown account → empty Balance array', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { status, json } = await getJson(
        `${baseUrl}/V2/json2/account/view/balances?account=unknown-999&fields=hebName`,
      );
      expect(status).toBe(200);
      const body = json as Record<string, unknown>;
      const view = body.View as Record<string, unknown>;
      const account = view.Account as Record<string, unknown>;
      const accountPos = account.AccountPosition as Record<string, unknown>;
      expect(accountPos.Balance).toEqual([]);
    } finally {
      await close();
    }
  });

  it('GET /V2/json2/market/table/simple?securities=5130919,5112628 → filtered Security array with HebName and CurrencyDivider', async () => {
    const { baseUrl, close } = await startTestServer();
    try {
      const { status, json } = await getJson(
        `${baseUrl}/V2/json2/market/table/simple?securities=5130919%2C5112628&fields=HebName,CurrencyDivider&catalog=unified`,
      );
      expect(status).toBe(200);
      const body = json as Record<string, unknown>;
      const table = body.Table as Record<string, unknown>;
      const securities = table.Security as Record<string, unknown>[];
      expect(Array.isArray(securities)).toBe(true);
      expect(securities).toHaveLength(2);
      expect(securities.map((s) => s['-Key']).sort()).toEqual(['5112628', '5130919']);
      expect(typeof securities[0].HebName).toBe('string');
      expect(securities[0].CurrencyDivider).toBe(100);
    } finally {
      await close();
    }
  });
});
