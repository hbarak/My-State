import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vite dev server plugin that serves mock Psagot API responses from local
 * fixture files. Allows dev/QA to work without hitting the real Psagot backend
 * (no OTP, no session expiry, no quota).
 *
 * Activated when VITE_MOCK_API=true (use `npm run dev:mock`).
 *
 * Fixture files live in src/mock/fixtures/:
 *   login-response.json         — POST /V2/json2/login (pending OTP)
 *   otp-response.json           — POST /V2/json2/login (any 6-digit OTP authorized)
 *   accounts-response.json      — GET /V2/json/accounts
 *   balances-{accountId}.json   — GET /V2/json2/account/view/balances?account={id}
 */

const PROXY_PREFIX = '/api/psagot';
// NOTE: Use import.meta.url instead of __dirname so this works correctly after ESM migration.
// __dirname is not available in ESM modules; import.meta.url is the ESM-safe equivalent.
const FIXTURES_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../mock/fixtures');

function loadFixture(name: string): string {
  const path = resolve(FIXTURES_DIR, `${name}.json`);
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`Mock fixture not found: ${name}.json (expected at ${path})`);
  }
}

function sendJson(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function mockHandler(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
): Promise<void> {
  const url = req.url ?? '';
  const method = (req.method ?? 'GET').toUpperCase();

  // POST /V2/json2/login — step 1 (no Token) or step 2 (with Token)
  if (method === 'POST' && url.startsWith('/V2/json2/login')) {
    const body = await readBody(req);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      // fall through — no token
    }
    const login = parsed.Login as Record<string, unknown> | undefined;
    const token = login?.Token as string | undefined;

    if (token && /^\d{6}$/.test(token)) {
      // Any 6-digit OTP → authorized
      sendJson(res, 200, loadFixture('otp-response'));
    } else {
      // No token → pending OTP
      sendJson(res, 200, loadFixture('login-response'));
    }
    return;
  }

  // GET /V2/json/accounts
  if (method === 'GET' && url.startsWith('/V2/json/accounts')) {
    sendJson(res, 200, loadFixture('accounts-response'));
    return;
  }

  // GET /V2/json2/market/table/simple?securities={ids}
  if (method === 'GET' && url.startsWith('/V2/json2/market/table/simple')) {
    const fixture = JSON.parse(loadFixture('security-info')) as { Table: { Security: Record<string, unknown>[] } };
    const requestedIds = new Set(
      (new URL(url, 'http://localhost').searchParams.get('securities') ?? '').split(',').map((s) => s.trim()),
    );
    const filtered = fixture.Table.Security.filter((s) => requestedIds.has(String(s['-Key'])));
    sendJson(res, 200, JSON.stringify({ Table: { ...fixture.Table, Security: filtered } }));
    return;
  }

  // GET /V2/json2/account/view/balances?account={id}
  if (method === 'GET' && url.startsWith('/V2/json2/account/view/balances')) {
    const accountParam = new URL(url, 'http://localhost').searchParams.get('account') ?? 'default';
    // Normalize account ID for filename: replace path separators with dashes
    const fixtureKey = `balances-${accountParam.replace(/[/\\]/g, '-')}`;
    try {
      sendJson(res, 200, loadFixture(fixtureKey));
    } catch {
      // No fixture for this account — return empty balances
      sendJson(res, 200, JSON.stringify({
        View: { Account: { AccountPosition: { Balance: [] } }, Meta: { Security: [] } },
      }));
    }
    return;
  }

  next();
}

export function psagotMockPlugin(): Plugin {
  return {
    name: 'psagot-mock',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(PROXY_PREFIX, ((
        req: IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction,
      ) => {
        mockHandler(req, res, next).catch(next);
      }) as Connect.NextHandleFunction);
    },
  } as Plugin;
}
