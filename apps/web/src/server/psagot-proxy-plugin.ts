import type { Plugin, ViteDevServer, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vite dev server plugin that proxies Psagot API requests server-side.
 *
 * The Psagot REST API at trade1.psagot.co.il does not set CORS headers for
 * localhost origins, so browser-direct fetch fails. This plugin forwards
 * requests from /api/psagot/* to trade1.psagot.co.il/* in Node.js,
 * bypassing CORS entirely.
 *
 * The PsagotApiClient uses this proxy by setting baseUrl to '/api/psagot'
 * in the browser context. All session/csession headers pass through.
 *
 * Production note (R5.5): replace with Supabase Edge Functions.
 */

const PSAGOT_ORIGIN = 'https://trade1.psagot.co.il';
const PROXY_PREFIX = '/api/psagot';
const MAX_BODY_BYTES = 64 * 1024;

/** Headers that should be forwarded from client to Psagot API. */
const FORWARDED_HEADERS = new Set(['session', 'csession', 'content-type', 'accept']);

function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(chunks.length > 0 ? Buffer.concat(chunks) : null);
    });
    req.on('error', reject);
  });
}

async function proxyHandler(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
): Promise<void> {
  const url = req.url;
  if (!url) {
    next();
    return;
  }

  // Middleware is mounted at PROXY_PREFIX, so url is already the suffix path
  const targetUrl = `${PSAGOT_ORIGIN}${url}`;

  // Build headers to forward
  const headers: Record<string, string> = {};
  for (const key of FORWARDED_HEADERS) {
    const value = req.headers[key];
    if (typeof value === 'string') {
      headers[key] = value;
    }
  }

  // Psagot expects Origin/Referer from their own domain
  headers['Origin'] = 'https://trade.psagot.co.il';
  headers['Referer'] = 'https://trade.psagot.co.il/';
  headers['Accept'] = headers['accept'] ?? '*/*';
  delete headers['accept']; // normalize casing

  // Psagot portal sends a browser-like User-Agent (Flutter web impersonates Chrome)
  headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

  // Read body for POST requests
  let bodyStr: string | undefined;
  if (req.method === 'POST') {
    try {
      const buf = await readBody(req);
      bodyStr = buf?.toString('utf-8');
    } catch {
      sendError(res, 413, 'Request body too large');
      return;
    }
  }

  // Debug: log outgoing request (remove once stable)
  // eslint-disable-next-line no-console
  console.log(`[psagot-proxy] ${req.method} ${targetUrl}`);
  // eslint-disable-next-line no-console
  console.log(`[psagot-proxy] headers:`, JSON.stringify(headers));
  if (bodyStr) {
    // eslint-disable-next-line no-console
    console.log(`[psagot-proxy] body: ${bodyStr}`);
  }

  // Forward to Psagot API
  try {
    const fetchInit: RequestInit = {
      method: req.method ?? 'GET',
      headers,
    };
    if (bodyStr !== undefined) {
      fetchInit.body = bodyStr;
    }

    const upstream = await fetch(targetUrl, fetchInit);

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const responseBody = await upstream.text();

    // Debug: log response (remove once stable)
    // eslint-disable-next-line no-console
    console.log(`[psagot-proxy] ← ${upstream.status} ${responseBody.slice(0, 500)}`);

    res.writeHead(upstream.status, { 'Content-Type': contentType });
    res.end(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[psagot-proxy] ERROR:`, err);
    sendError(res, 502, `Psagot proxy error: ${message}`);
  }
}

export function psagotProxyPlugin(): Plugin {
  return {
    name: 'psagot-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(PROXY_PREFIX, ((
        req: IncomingMessage,
        res: ServerResponse,
        next: Connect.NextFunction,
      ) => {
        proxyHandler(req, res, next).catch(next);
      }) as Connect.NextHandleFunction);
    },
  } as Plugin;
}
