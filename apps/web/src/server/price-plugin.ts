import type { Plugin, ViteDevServer, Connect, ResolvedConfig } from 'vite';
import { loadEnv } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EODHDClient } from 'eodhd';

/**
 * Vite dev server plugin that proxies price API requests to external sources.
 *
 * Registers three Connect middleware endpoints:
 *   POST /api/prices        — EODHD batch real-time quote lookup, returns PriceResult[]
 *   POST /api/prices-maya   — Maya TASE API fund NAV lookup, returns PriceResult[]
 *   POST /api/ticker-search — EODHD search by query, returns { ticker: string | null }
 *
 * Price routing is handled client-side by FanOutPriceFetcher:
 *   - TASE numeric fund IDs (all-digit strings) → /api/prices-maya → Maya API (server-side, bypasses CORS)
 *   - All other tickers → /api/prices → EODHD
 *
 * eodhd is a Node-only library. This plugin runs in Vite's Node.js
 * runtime and is never bundled into the browser build.
 *
 * Requires EODHD_API_KEY environment variable. Missing key returns HTTP 503 for
 * EODHD endpoints. Maya endpoints require no API key.
 *
 * Production note (R5.5): replace with Supabase Edge Functions or a serverless
 * API. Remove or guard this plugin behind `mode === 'development'` at that time.
 */

const MAX_TICKERS = 50;
const MAX_BODY_BYTES = 64 * 1024; // 64KB — generous for up to 50 short ticker strings

/**
 * Reads and parses a JSON body from a Node.js IncomingMessage stream.
 * Throws if the body exceeds MAX_BODY_BYTES or is not valid JSON.
 * Callers should catch `BodyTooLargeError` to respond with 413.
 */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

interface PriceResult {
  ticker: string;
  status: 'success' | 'error';
  price?: number;
  currency?: string;
  error?: string;
}

/**
 * Infers currency from the EODHD ticker suffix.
 * .TA  → ILS (Tel Aviv Stock Exchange)
 * .US or bare ticker → USD
 * Others → undefined (let the UI handle missing currency gracefully)
 */
function inferCurrency(ticker: string): string | undefined {
  if (ticker.endsWith('.TA')) return 'ILS';
  if (ticker.endsWith('.US') || !ticker.includes('.')) return 'USD';
  return undefined;
}

/**
 * Ensures a US-style ticker has the .US suffix required by EODHD.
 * TASE tickers (already have a suffix, e.g. .TA) are returned unchanged.
 * Used only inside the adapter — domain never sees this transformation.
 */
function toEodhdTicker(ticker: string): string {
  if (ticker.includes('.')) return ticker; // already has an exchange suffix
  return `${ticker}.US`;
}

/**
 * POST /api/prices
 * Body: { tickers: string[] }
 * Response: PriceResult[]
 *
 * Uses a single EODHD batch call (1 quota unit per refresh regardless of ticker count).
 * Never returns non-200 for per-ticker errors — those are included in the body.
 * Returns 400 for invalid requests, 503 if EODHD_API_KEY is missing, 502 on API error.
 */
async function pricesHandler(req: IncomingMessage, res: ServerResponse, apiKey: string | undefined): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  if (!apiKey) {
    sendError(res, 503, 'EODHD_API_KEY not configured');
    return;
  }

  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      sendError(res, 413, 'Request body too large');
    } else {
      sendError(res, 400, 'Invalid JSON body');
    }
    return;
  }

  if (typeof body !== 'object' || body === null || !('tickers' in body)) {
    sendError(res, 400, 'Missing required field: tickers');
    return;
  }

  const { tickers } = body as Record<string, unknown>;

  if (!Array.isArray(tickers)) {
    sendError(res, 400, 'Field "tickers" must be an array');
    return;
  }

  if (!tickers.every((t): t is string => typeof t === 'string')) {
    sendError(res, 400, 'Field "tickers" must be an array of strings');
    return;
  }

  if (tickers.length === 0) {
    sendJson(res, []);
    return;
  }

  if (tickers.length > MAX_TICKERS) {
    sendError(res, 400, `Too many tickers: max ${MAX_TICKERS}`);
    return;
  }

  const client = new EODHDClient({ apiToken: apiKey });

  // Map each domain ticker to its EODHD-format ticker, tracking the original
  const eodhdTickers = tickers.map(toEodhdTicker);

  // Batch call: first ticker in path, rest in `s` param — counts as 1 quota unit
  const [firstTicker, ...remainingTickers] = eodhdTickers;
  const sParam = remainingTickers.join(',');

  let quotesRaw: unknown;
  try {
    quotesRaw = await client.realTime(firstTicker, sParam ? { s: sParam } : undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 502, `EODHD error: ${message}`);
    return;
  }

  // realTime() returns a single RealTimeQuote when called without `s`, array when batched
  const quotesArray = Array.isArray(quotesRaw) ? quotesRaw : [quotesRaw];

  // Build a map from EODHD ticker code → quote for O(1) lookup
  const quoteByCode = new Map<string, { close: number }>(
    quotesArray
      .filter((q): q is { code: string; close: number } =>
        q != null && typeof q === 'object' && 'code' in q && typeof q.code === 'string',
      )
      .map((q) => [q.code, q]),
  );

  const results: PriceResult[] = tickers.map((ticker, i) => {
    const eodhdCode = eodhdTickers[i];
    const quote = quoteByCode.get(eodhdCode);
    if (!quote || quote.close == null) {
      return {
        ticker,
        status: 'error' as const,
        error: quote ? 'Missing price in response' : 'Ticker not found',
      };
    }
    // EODHD returns TASE prices in agorot (1/100 ILS) — convert to ILS
    const price = ticker.endsWith('.TA') ? quote.close / 100 : quote.close;
    return {
      ticker,
      status: 'success' as const,
      price,
      currency: inferCurrency(ticker),
    };
  });

  sendJson(res, results);
}

// ---------------------------------------------------------------------------
// TASE fund/ETF price lookup (server-side to bypass CORS)
// ---------------------------------------------------------------------------

// Endpoint 1: Israeli mutual funds (Type 4) — mayaapi.tase.co.il
const MAYA_FUND_URL = 'https://mayaapi.tase.co.il/api/fund/details';
// Endpoint 2: Foreign ETFs listed on TASE (Type 1, SubType 44) — api.tase.co.il
const TASE_SECURITY_URL = 'https://api.tase.co.il/api/company/securitydata';

const TASE_HEADERS: Record<string, string> = {
  'X-Maya-With': 'allow',
  'Accept-Language': 'en-US',
  'Referer': 'https://www.tase.co.il/',
  'Accept': 'application/json',
};

/**
 * Extracts the NAV (price) from a Maya fund/details response body.
 *
 * Confirmed field: UnitValuePrice (flat top-level field, Type 4 Israeli mutual funds).
 * Value is in agorot (1/100 ILS) — caller divides by 100.
 * Exported for unit testing.
 */
export function extractNav(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const obj = body as Record<string, unknown>;

  if (typeof obj['UnitValuePrice'] === 'number' && (obj['UnitValuePrice'] as number) > 0) {
    return obj['UnitValuePrice'] as number;
  }

  return null;
}

/**
 * Extracts the last rate from a TASE company/securitydata response body.
 *
 * Confirmed field: LastRate (flat top-level field, Type 1 Foreign ETFs on TASE).
 * Exported for unit testing.
 */
export function extractLastRate(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const obj = body as Record<string, unknown>;

  if (typeof obj['LastRate'] === 'number' && (obj['LastRate'] as number) > 0) {
    return obj['LastRate'] as number;
  }

  return null;
}

/**
 * Tries endpoint 1 (Maya fund/details). On HTTP 404, falls back to endpoint 2
 * (TASE company/securitydata). This covers both Israeli mutual funds (Type 4)
 * and foreign ETFs listed on TASE (Type 1, e.g. S&P500 trackers).
 *
 * Psagot-internal IDs (e.g. 72179369) that don't exist in either TASE API
 * will return a per-ticker error — never throws for the batch.
 */
async function fetchOneMayaFund(fundId: string): Promise<PriceResult> {
  // --- Endpoint 1: mutual fund NAV ---
  const fundUrl = `${MAYA_FUND_URL}?fundId=${encodeURIComponent(fundId)}`;
  let response: globalThis.Response;
  try {
    response = await fetch(fundUrl, { headers: TASE_HEADERS });
  } catch (err) {
    return {
      ticker: fundId,
      status: 'error',
      error: `TASE network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ticker: fundId, status: 'error', error: 'Maya API: invalid JSON response' };
    }
    const nav = extractNav(body);
    if (nav !== null) {
      // UnitValuePrice is in agorot (1/100 ILS) — convert to ILS
      return { ticker: fundId, status: 'success', price: nav / 100, currency: 'ILS' };
    }
    return { ticker: fundId, status: 'error', error: 'Maya API: NAV not found in response' };
  }

  // Only fall back on 404 — other errors (5xx, 403) are surfaced directly
  if (response.status !== 404) {
    return { ticker: fundId, status: 'error', error: `Maya API HTTP ${response.status}` };
  }

  // --- Endpoint 2: foreign ETF last rate ---
  const securityUrl = `${TASE_SECURITY_URL}?securityId=${encodeURIComponent(fundId)}&lang=1`;
  let secResponse: globalThis.Response;
  try {
    secResponse = await fetch(securityUrl, { headers: TASE_HEADERS });
  } catch (err) {
    return {
      ticker: fundId,
      status: 'error',
      error: `TASE security API network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!secResponse.ok) {
    return { ticker: fundId, status: 'error', error: `TASE security API HTTP ${secResponse.status}` };
  }

  let secBody: unknown;
  try {
    secBody = await secResponse.json();
  } catch {
    return { ticker: fundId, status: 'error', error: 'TASE security API: invalid JSON response' };
  }

  const lastRate = extractLastRate(secBody);
  if (lastRate === null) {
    return { ticker: fundId, status: 'error', error: 'TASE security API: LastRate not found in response' };
  }

  // LastRate is in agorot (1/100 ILS) — convert to ILS
  return { ticker: fundId, status: 'success', price: lastRate / 100, currency: 'ILS' };
}

/**
 * POST /api/prices-maya
 * Body: { tickers: string[] }  (TASE numeric fund IDs, e.g. ["1183441", "5112628"])
 * Response: PriceResult[]
 *
 * Calls the Maya TASE API server-side (Node.js) to bypass browser CORS restrictions.
 * Each fund ID is fetched in parallel. Never returns non-200 for per-ticker errors.
 */
async function mayaPricesHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      sendError(res, 413, 'Request body too large');
    } else {
      sendError(res, 400, 'Invalid JSON body');
    }
    return;
  }

  if (typeof body !== 'object' || body === null || !('tickers' in body)) {
    sendError(res, 400, 'Missing required field: tickers');
    return;
  }

  const { tickers } = body as Record<string, unknown>;

  if (!Array.isArray(tickers) || !tickers.every((t): t is string => typeof t === 'string')) {
    sendError(res, 400, 'Field "tickers" must be an array of strings');
    return;
  }

  if (tickers.length === 0) {
    sendJson(res, []);
    return;
  }

  const results = await Promise.all(tickers.map(fetchOneMayaFund));
  sendJson(res, results);
}

/**
 * POST /api/ticker-search
 * Body: { query: string }
 * Response: { ticker: string } | { ticker: null }
 *
 * Searches EODHD for a matching stock ticker. Prefers TLV exchange for Israeli
 * securities, NYSE/NASDAQ/US for US securities.
 * Returns 400 for invalid requests, 503 if EODHD_API_KEY is missing, 502 on API error.
 */
async function tickerSearchHandler(req: IncomingMessage, res: ServerResponse, apiKey: string | undefined): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  if (!apiKey) {
    sendError(res, 503, 'EODHD_API_KEY not configured');
    return;
  }

  let body: unknown;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      sendError(res, 413, 'Request body too large');
    } else {
      sendError(res, 400, 'Invalid JSON body');
    }
    return;
  }

  if (typeof body !== 'object' || body === null || !('query' in body)) {
    sendError(res, 400, 'Missing required field: query');
    return;
  }

  const { query } = body as Record<string, unknown>;

  if (typeof query !== 'string' || query.trim() === '') {
    sendError(res, 400, 'Field "query" must be a non-empty string');
    return;
  }

  const q = query.trim();
  const client = new EODHDClient({ apiToken: apiKey });

  let results: { Code: string; Exchange: string; Type: string }[];
  try {
    results = await client.search(q, { limit: 5, type: 'stock' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 502, `EODHD search error: ${message}`);
    return;
  }

  // Prefer TLV for Israeli securities, then NYSE/NASDAQ/US for US
  const ISRAELI_EXCHANGES = new Set(['TLV', 'TA']);
  const US_EXCHANGES = new Set(['NYSE', 'NASDAQ', 'US']);

  const israeliMatch = results.find(
    (r) => r.Type === 'Common Stock' && ISRAELI_EXCHANGES.has(r.Exchange),
  );
  if (israeliMatch) {
    sendJson(res, { ticker: `${israeliMatch.Code}.TA` });
    return;
  }

  const usMatch = results.find(
    (r) => r.Type === 'Common Stock' && US_EXCHANGES.has(r.Exchange),
  );
  if (usMatch) {
    // Return bare ticker for US (domain uses plain AAPL, not AAPL.US)
    sendJson(res, { ticker: usMatch.Code });
    return;
  }

  // Fallback: first stock result regardless of exchange
  const anyMatch = results.find((r) => r.Code);
  if (anyMatch) {
    const suffix = ISRAELI_EXCHANGES.has(anyMatch.Exchange) ? '.TA' : '';
    sendJson(res, { ticker: `${anyMatch.Code}${suffix}` });
    return;
  }

  sendJson(res, { ticker: null });
}

/**
 * Returns the Vite plugin that registers the price API middleware.
 */
export function pricePlugin(): Plugin {
  let resolvedApiKey: string | undefined;

  return {
    name: 'price-api',
    configResolved(config: ResolvedConfig) {
      // Load .env from the Vite root so process.env isn't required.
      // loadEnv returns all vars (including non-VITE_ prefixed) when prefix is ''.
      const env = loadEnv(config.mode, config.root, '');
      resolvedApiKey = env['EODHD_API_KEY'] ?? process.env.EODHD_API_KEY;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/prices', ((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        pricesHandler(req, res, resolvedApiKey).catch(next);
      }) as Connect.NextHandleFunction);
      server.middlewares.use('/api/prices-maya', ((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        mayaPricesHandler(req, res).catch(next);
      }) as Connect.NextHandleFunction);
      server.middlewares.use('/api/ticker-search', ((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        tickerSearchHandler(req, res, resolvedApiKey).catch(next);
      }) as Connect.NextHandleFunction);
    },
  } as Plugin;
}
