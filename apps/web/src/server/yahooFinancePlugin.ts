import type { Plugin, ViteDevServer, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

/**
 * Vite dev server plugin that proxies Yahoo Finance API requests.
 *
 * Registers two Connect middleware endpoints:
 *   POST /api/prices        — batch quote lookup, returns PriceResult[]
 *   POST /api/ticker-search — search by query, returns { ticker: string | null }
 *
 * yahoo-finance2 is a Node-only library. This plugin runs in Vite's Node.js
 * runtime and is never bundled into the browser build.
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

/**
 * Writes a JSON error response.
 */
function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/**
 * Writes a JSON success response.
 */
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
 * POST /api/prices
 * Body: { tickers: string[] }
 * Response: PriceResult[]
 *
 * Never returns non-200 for per-ticker errors — those are included in the body.
 * Returns 400 for invalid requests, 502 if yahoo-finance2 throws.
 */
async function pricesHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  if (
    typeof body !== 'object' ||
    body === null ||
    !('tickers' in body)
  ) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let quotes: any;
  try {
    quotes = await yahooFinance.quote(tickers as any);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 502, `Yahoo Finance error: ${message}`);
    return;
  }

  // yahoo-finance2.quote() returns a single result or an array depending on input.
  // When given an array, it returns an array. Normalise to array.
  const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

  // Build a map from symbol -> quote for O(1) lookup.
  const quoteBySymbol = new Map(
    quotesArray
      .filter((q) => q != null && typeof q.symbol === 'string')
      .map((q) => [q.symbol, q] as const),
  );

  const results: PriceResult[] = tickers.map((ticker) => {
    const quote = quoteBySymbol.get(ticker);
    if (!quote || quote.regularMarketPrice == null) {
      return {
        ticker,
        status: 'error' as const,
        error: quote ? 'Missing price in response' : 'Ticker not found',
      };
    }
    return {
      ticker,
      status: 'success' as const,
      price: quote.regularMarketPrice,
      currency: quote.currency ?? undefined,
    };
  });

  sendJson(res, results);
}

/**
 * POST /api/ticker-search
 * Body: { query: string }
 * Response: { ticker: string } | { ticker: null }
 *
 * Probes Yahoo Finance by trying the query as a ticker directly (e.g. "604611" → "604611.TA"),
 * then as-is. Returns the first candidate that has a valid market price.
 * Returns 400 for invalid requests, 502 if yahoo-finance2 throws unexpectedly.
 */
async function tickerSearchHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  // Try candidates in order: append .TA suffix (TASE), then bare query
  const candidates = [`${q}.TA`, q];

  for (const candidate of candidates) {
    try {
      const quote = await yahooFinance.quote(candidate);
      if (quote?.regularMarketPrice != null) {
        sendJson(res, { ticker: candidate });
        return;
      }
    } catch {
      // candidate not found — try next
    }
  }

  sendJson(res, { ticker: null });
}

/**
 * Returns the Vite plugin that registers the Yahoo Finance API middleware.
 */
export function yahooFinancePlugin(): Plugin {
  return {
    name: 'yahoo-finance-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/prices', ((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        pricesHandler(req, res).catch(next);
      }) as Connect.NextHandleFunction);
      server.middlewares.use('/api/ticker-search', ((req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        tickerSearchHandler(req, res).catch(next);
      }) as Connect.NextHandleFunction);
    },
  } as Plugin;
}
