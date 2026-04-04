import type { Plugin, ViteDevServer, Connect, ResolvedConfig } from 'vite';
import { loadEnv } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EODHDClient, EODHDError } from 'eodhd';

/**
 * Vite dev server plugin that proxies EODHD API requests.
 *
 * Registers two Connect middleware endpoints:
 *   POST /api/prices        — batch real-time quote lookup, returns PriceResult[]
 *   POST /api/ticker-search — search by query, returns { ticker: string | null }
 *
 * eodhd is a Node-only library. This plugin runs in Vite's Node.js
 * runtime and is never bundled into the browser build.
 *
 * Requires EODHD_API_KEY environment variable. Missing key returns HTTP 503.
 *
 * Production note (R5.5): replace with Supabase Edge Functions or a serverless
 * API. Remove or guard this plugin behind `mode === 'development'` at that time.
 */

const MAX_TICKERS = 50;
const MAX_BODY_BYTES = 64 * 1024; // 64KB — generous for up to 50 short ticker strings

// [TEMPORARY: S9 diagnostic — remove before R10]
let _eohdCallCount = 0;

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
 * Translates an EODHD API error into a structured response body.
 * Returns the quota_exceeded shape for HTTP 402, otherwise returns null
 * (caller should propagate as 502).
 */
export function translateEodhdError(err: unknown): { error: string; message: string } | null {
  if (err instanceof EODHDError && err.statusCode === 402) {
    return { error: 'quota_exceeded', message: 'Daily price limit reached. Prices will refresh tomorrow.' };
  }
  return null;
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

  // Mock path for QA E2E: ?mock_402=true simulates EODHD quota exhaustion
  if (new URL(req.url ?? '/', 'http://localhost').searchParams.get('mock_402') === 'true') {
    sendJson(res, { error: 'quota_exceeded', message: 'Daily price limit reached. Prices will refresh tomorrow.' });
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

  // [TEMPORARY: S9 diagnostic — remove before R10]
  _eohdCallCount++;
  console.info(`[EODHD] call #${_eohdCallCount} in this session`);

  let quotesRaw: unknown;
  try {
    quotesRaw = await client.realTime(firstTicker, sParam ? { s: sParam } : undefined);
  } catch (err) {
    const translated = translateEodhdError(err);
    if (translated) {
      sendJson(res, translated);
      return;
    }
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
 * Returns the Vite plugin that registers the EODHD API middleware.
 */
export function eodhdPricePlugin(): Plugin {
  let resolvedApiKey: string | undefined;

  return {
    name: 'eodhd-price-api',
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
      server.middlewares.use('/api/ticker-search', ((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        tickerSearchHandler(req, res, resolvedApiKey).catch(next);
      }) as Connect.NextHandleFunction);
    },
  } as Plugin;
}
