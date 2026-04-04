import { describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { EODHDError } from 'eodhd';
import { translateEodhdError } from '../src/plugins/eodhd-price-plugin';

/**
 * Tests for EODHD 402 quota-exceeded error handling.
 *
 * translateEodhdError is tested as a pure unit.
 * The mock_402 query param path is tested via the integration server pattern
 * (no real EODHD API call needed — the param short-circuits before the client).
 */

type NextFn = () => void;
type MiddlewareFn = (req: IncomingMessage, res: ServerResponse, next: NextFn) => void;

async function importPricesHandler(): Promise<MiddlewareFn> {
  const { eodhdPricePlugin } = await import('../src/plugins/eodhd-price-plugin');
  const plugin = eodhdPricePlugin();

  let capturedHandler: MiddlewareFn | null = null;

  const fakeServer = {
    middlewares: {
      use(prefix: string, handler: MiddlewareFn) {
        if (prefix === '/api/prices') capturedHandler = handler;
      },
    },
  };

  const fakeConfig = { mode: 'test', root: process.cwd(), env: {} };
  (plugin.configResolved as (c: unknown) => void)(fakeConfig);
  (plugin.configureServer as (s: unknown) => void)(fakeServer);

  if (!capturedHandler) throw new Error('eodhdPricePlugin did not register /api/prices handler');
  return capturedHandler;
}

async function startPricesServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const handler = await importPricesHandler();

  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/prices')) {
      req.url = req.url.slice('/api/prices'.length) || '/';
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
        baseUrl: `http://127.0.0.1:${port}/api/prices`,
        close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

// ── Unit: translateEodhdError ─────────────────────────────────────────────────

describe('translateEodhdError', () => {
  it('returns quota_exceeded shape for EODHDError with statusCode 402', () => {
    const err = new EODHDError('Payment Required', 402);
    const result = translateEodhdError(err);
    expect(result).not.toBeNull();
    expect(result!.error).toBe('quota_exceeded');
    expect(typeof result!.message).toBe('string');
    expect(result!.message.length).toBeGreaterThan(0);
  });

  it('returns null for EODHDError with non-402 status code', () => {
    const err = new EODHDError('Server Error', 500);
    expect(translateEodhdError(err)).toBeNull();
  });

  it('returns null for a generic Error', () => {
    expect(translateEodhdError(new Error('network timeout'))).toBeNull();
  });

  it('returns null for non-Error values', () => {
    expect(translateEodhdError('string error')).toBeNull();
    expect(translateEodhdError(null)).toBeNull();
  });
});

// ── Integration: mock_402 query param ────────────────────────────────────────

describe('eodhdPricePlugin — mock_402 path', () => {
  it('POST /api/prices?mock_402=true → quota_exceeded without hitting EODHD API', async () => {
    const { baseUrl, close } = await startPricesServer();
    try {
      const res = await fetch(`${baseUrl}?mock_402=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: ['SPY'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('quota_exceeded');
      expect(typeof body.message).toBe('string');
    } finally {
      await close();
    }
  });

  it('POST /api/prices without mock_402 and no API key → 503 (not quota_exceeded)', async () => {
    const { baseUrl, close } = await startPricesServer();
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: ['SPY'] }),
      });
      // No API key configured in test env → 503, not quota_exceeded
      expect(res.status).toBe(503);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).not.toBe('quota_exceeded');
    } finally {
      await close();
    }
  });
});
