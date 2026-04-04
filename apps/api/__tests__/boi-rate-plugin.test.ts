import { describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { parseBoiResponse } from '../src/plugins/boi-rate-plugin';

/**
 * Integration tests for boiRatePlugin.
 *
 * The mock-mode handler is tested via a minimal HTTP test server (same pattern
 * as psagot-mock-plugin.test.ts). The parseBoiResponse helper is tested as a
 * pure unit to cover the malformed-response branch without needing a network.
 */

type NextFn = () => void;
type MiddlewareFn = (req: IncomingMessage, res: ServerResponse, next: NextFn) => void;

async function importBoiHandler(mockMode: boolean): Promise<MiddlewareFn> {
  const { boiRatePlugin } = await import('../src/plugins/boi-rate-plugin');
  const plugin = boiRatePlugin();

  let capturedHandler: MiddlewareFn | null = null;

  const fakeServer = {
    middlewares: {
      use(_prefix: string, handler: MiddlewareFn) {
        capturedHandler = handler;
      },
    },
  };

  // Simulate configResolved with the desired mock mode
  const fakeConfig = { env: { VITE_MOCK_API: mockMode ? 'true' : 'false' } };
  (plugin.configResolved as (c: unknown) => void)(fakeConfig);
  (plugin.configureServer as (s: unknown) => void)(fakeServer);

  if (!capturedHandler) throw new Error('BoI plugin did not register a handler');
  return capturedHandler;
}

async function startTestServer(mockMode: boolean): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const handler = await importBoiHandler(mockMode);

  const server = createServer((req, res) => {
    // Strip /api/boi-rate prefix to match how Vite mounts sub-path middleware
    if (req.url?.startsWith('/api/boi-rate')) {
      req.url = req.url.slice('/api/boi-rate'.length) || '/';
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
        baseUrl: `http://127.0.0.1:${port}/api/boi-rate`,
        close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
  });
}

// ── Integration: mock mode ────────────────────────────────────────────────────

describe('boiRatePlugin — mock mode', () => {
  it('GET /api/boi-rate → { rate: number, date: string } from fixture', async () => {
    const { baseUrl, close } = await startTestServer(true);
    try {
      const res = await fetch(baseUrl);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.rate).toBe('number');
      expect(body.rate).toBeGreaterThan(0);
      expect(typeof body.date).toBe('string');
      expect((body.date as string).length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('POST /api/boi-rate → 405 Method Not Allowed', async () => {
    const { baseUrl, close } = await startTestServer(true);
    try {
      const res = await fetch(baseUrl, { method: 'POST' });
      expect(res.status).toBe(405);
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.error).toBe('string');
    } finally {
      await close();
    }
  });
});

// ── Unit: parseBoiResponse ────────────────────────────────────────────────────

describe('parseBoiResponse', () => {
  it('returns rate and date from valid BoI response', () => {
    const raw = { seriesData: [{ date: '2026-04-04', value: '3.7012' }] };
    const result = parseBoiResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(3.7012);
    expect(result!.date).toBe('2026-04-04');
  });

  it('returns null when seriesData is empty', () => {
    expect(parseBoiResponse({ seriesData: [] })).toBeNull();
  });

  it('returns null when value is not a parseable number', () => {
    expect(parseBoiResponse({ seriesData: [{ date: '2026-04-04', value: 'N/A' }] })).toBeNull();
  });

  it('returns null when value parses to zero', () => {
    expect(parseBoiResponse({ seriesData: [{ date: '2026-04-04', value: '0' }] })).toBeNull();
  });

  it('returns null when seriesData is missing', () => {
    expect(parseBoiResponse({})).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseBoiResponse(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseBoiResponse('bad')).toBeNull();
  });

  it('returns null when date field is missing', () => {
    expect(parseBoiResponse({ seriesData: [{ value: '3.70' }] })).toBeNull();
  });
});
