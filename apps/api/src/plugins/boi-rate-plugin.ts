import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vite dev server plugin that proxies the Bank of Israel (BoI) שער יציג
 * (representative USD/ILS exchange rate) endpoint.
 *
 * Registers one Connect middleware endpoint:
 *   GET /api/boi-rate  — returns { rate: number, date: string }
 *
 * The BoI API is public (no API key required). This proxy exists solely to
 * avoid CORS restrictions in the browser — all external API calls must go
 * through the BFF (apps/api), never from the browser directly.
 *
 * Error path: if the BoI API is unavailable or returns a malformed response,
 * returns { error: 'rate_unavailable' } with HTTP 200 (structured error,
 * consistent with the EODHD per-item error pattern).
 *
 * Mock mode: when VITE_MOCK_API=true the plugin serves the local fixture
 * (src/fixtures/boi-rate.json) instead of calling the real API. This keeps
 * mocking self-contained in the plugin — no separate mock server extension
 * is needed for this endpoint.
 *
 * Production note (R10): replace with a stateless serverless function.
 * The plugin is already stateless so the migration is a direct lift-and-shift.
 */

const BOI_API_URL =
  'https://edge.boi.gov.il/FusionEdge/series/getSeriesData.js?id=RER_USD_ILS&format=json&lang=en&first=1&last=1';

const FIXTURES_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures');

function loadFixture(name: string): string {
  const path = resolve(FIXTURES_DIR, `${name}.json`);
  return readFileSync(path, 'utf-8');
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * BoI API response shape (relevant fields only).
 * The full response contains additional metadata we do not need.
 */
interface BoiSeriesEntry {
  date: string;
  value: string;
}

interface BoiApiResponse {
  seriesData?: BoiSeriesEntry[];
}

/**
 * Parses the BoI API response and extracts the rate and date.
 * Returns null if the response is malformed or the rate cannot be parsed.
 */
export function parseBoiResponse(raw: unknown): { rate: number; date: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as BoiApiResponse;
  const entries = data.seriesData;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const first = entries[0];
  if (typeof first?.date !== 'string' || typeof first?.value !== 'string') return null;
  const rate = parseFloat(first.value);
  if (!isFinite(rate) || rate <= 0) return null;
  return { rate, date: first.date };
}

async function boiRateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  isMockMode: boolean,
): Promise<void> {
  if (req.method !== 'GET') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  // Mock mode: serve fixture instead of hitting real BoI API
  if (isMockMode) {
    try {
      sendJson(res, JSON.parse(loadFixture('boi-rate')));
    } catch {
      sendJson(res, { error: 'rate_unavailable' });
    }
    return;
  }

  let raw: unknown;
  try {
    const response = await fetch(BOI_API_URL);
    if (!response.ok) {
      sendJson(res, { error: 'rate_unavailable' });
      return;
    }
    raw = await response.json();
  } catch {
    sendJson(res, { error: 'rate_unavailable' });
    return;
  }

  const parsed = parseBoiResponse(raw);
  if (!parsed) {
    sendJson(res, { error: 'rate_unavailable' });
    return;
  }

  sendJson(res, parsed);
}

/**
 * Returns the Vite plugin that registers the Bank of Israel rate middleware.
 */
export function boiRatePlugin(): Plugin {
  let isMockMode = false;

  return {
    name: 'boi-rate-api',
    configResolved(config) {
      // loadEnv is not needed — VITE_MOCK_API is already in process.env at this point
      // because it is set by the npm run dev:mock script before Vite starts.
      isMockMode = config.env['VITE_MOCK_API'] === 'true';
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/boi-rate', ((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        boiRateHandler(req, res, isMockMode).catch(next);
      }) as Connect.NextHandleFunction);
    },
  } as Plugin;
}
