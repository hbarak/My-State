import type { Plugin, ViteDevServer, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vite dev server plugin that proxies ClientAM (IB Israel) portal API requests
 * to https://www.clientam.com/portal.proxy/v1/portal.
 *
 * ClientAM is IB Israel's white-label portal. It exposes the same IB Client Portal API
 * behind SSO authentication. The user logs in via their browser; the app forwards their
 * session cookies through this proxy.
 *
 * Cookie forwarding: The client sends cookies in the `X-ClientAM-Cookies` header.
 * This plugin reads that header and sets it as the `Cookie` header on the upstream request.
 * This avoids polluting the browser's cookie jar with ClientAM cookies.
 */

const PROXY_PREFIX = '/api/clientam';
const CLIENTAM_BASE_URL = 'https://www.clientam.com/portal.proxy/v1/portal';
const MAX_BODY_BYTES = 64 * 1024;

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
    req.on('end', () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : null));
    req.on('error', reject);
  });
}

async function proxyHandler(
  req: IncomingMessage,
  res: ServerResponse,
  next: Connect.NextFunction,
): Promise<void> {
  const url = req.url;
  if (!url) { next(); return; }

  const targetUrl = `${CLIENTAM_BASE_URL}${url}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  };

  // Forward session cookies from the custom header
  const clientamCookies = req.headers['x-clientam-cookies'];
  if (typeof clientamCookies === 'string' && clientamCookies.length > 0) {
    headers['Cookie'] = clientamCookies;
  }

  let bodyStr: string | undefined;
  if (req.method === 'POST' || req.method === 'PUT') {
    try {
      const buf = await readBody(req);
      bodyStr = buf?.toString('utf-8');
    } catch {
      sendError(res, 413, 'Request body too large');
      return;
    }
  }

  try {
    const fetchInit: RequestInit = {
      method: req.method ?? 'GET',
      headers,
    };
    if (bodyStr) fetchInit.body = bodyStr;

    const upstream = await fetch(targetUrl, fetchInit);

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const setCookie = upstream.headers.get('set-cookie');
    const responseHeaders: Record<string, string | string[]> = { 'Content-Type': contentType };
    if (setCookie) responseHeaders['Set-Cookie'] = setCookie;

    const responseBody = await upstream.text();
    res.writeHead(upstream.status, responseHeaders);
    res.end(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 502, `ClientAM proxy error: ${message}`);
  }
}

export function clientamProxyPlugin(): Plugin {
  return {
    name: 'clientam-proxy',
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
