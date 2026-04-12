import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vite dev server plugin that serves mock IB Client Portal API responses.
 * Activated when VITE_MOCK_API=true (use `npm run dev:mock`).
 *
 * No IB Gateway or IB account needed in mock mode.
 *
 * Fixture files:
 *   ib-auth-status.json              — GET  /iserver/auth/status
 *   ib-tickle.json                   — POST /tickle
 *   ib-accounts.json                 — GET  /portfolio/accounts
 *   ib-positions-{accountId}.json    — GET  /portfolio/{accountId}/positions/{page}
 *   ib-marketdata-snapshot.json      — GET  /iserver/marketdata/snapshot
 */

const PROXY_PREFIX = '/api/ib';
const FIXTURES_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures');

function loadFixture(name: string): string {
  const path = resolve(FIXTURES_DIR, `${name}.json`);
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`IB mock fixture not found: ${name}.json (expected at ${path})`);
  }
}

function sendJson(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function mockHandler(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
): Promise<void> {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';

  // GET /iserver/auth/status
  if (method === 'GET' && url === '/iserver/auth/status') {
    sendJson(res, 200, loadFixture('ib-auth-status'));
    return;
  }

  // POST /tickle
  if (method === 'POST' && url === '/tickle') {
    sendJson(res, 200, loadFixture('ib-tickle'));
    return;
  }

  // POST /iserver/auth/ssodh/init
  if (method === 'POST' && url.startsWith('/iserver/auth/ssodh/init')) {
    sendJson(res, 200, JSON.stringify({ authenticated: true }));
    return;
  }

  // GET /portfolio/accounts
  if (method === 'GET' && url === '/portfolio/accounts') {
    sendJson(res, 200, loadFixture('ib-accounts'));
    return;
  }

  // GET /portfolio/{accountId}/positions/{page}
  const positionsMatch = url.match(/^\/portfolio\/([^/]+)\/positions\/(\d+)$/);
  if (method === 'GET' && positionsMatch) {
    const accountId = positionsMatch[1];
    const page = parseInt(positionsMatch[2], 10);
    // Only page 0 has data; subsequent pages return empty
    if (page === 0) {
      try {
        sendJson(res, 200, loadFixture(`ib-positions-${accountId}`));
      } catch {
        sendJson(res, 200, '[]');
      }
    } else {
      sendJson(res, 200, '[]');
    }
    return;
  }

  // GET /iserver/marketdata/snapshot
  if (method === 'GET' && url.startsWith('/iserver/marketdata/snapshot')) {
    sendJson(res, 200, loadFixture('ib-marketdata-snapshot'));
    return;
  }

  next();
}

export function ibMockPlugin(): Plugin {
  return {
    name: 'ib-mock',
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
