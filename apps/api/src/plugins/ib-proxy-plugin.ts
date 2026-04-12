import type { Plugin, ViteDevServer, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vite dev server plugin that proxies IB Client Portal API requests
 * to the local IB Gateway running at IB_GATEWAY_URL (default: https://localhost:5000/v1/api).
 *
 * The IB Gateway (Docker or Java JAR) must be running and authenticated
 * before requests will succeed. The user logs in via the gateway's browser UI.
 *
 * The IBApiClient calls /api/ib/* which this plugin forwards to the gateway.
 *
 * HTTPS note: The IB Gateway uses a self-signed cert. NODE_TLS_REJECT_UNAUTHORIZED=0
 * is set for the proxy fetch to bypass the self-signed cert check in dev.
 * Never use this in production — production should use a proper gateway setup.
 */

const PROXY_PREFIX = '/api/ib';
const DEFAULT_GATEWAY_URL = 'https://localhost:5000/v1/api';
const MAX_BODY_BYTES = 64 * 1024;

function getGatewayUrl(): string {
  return process.env.IB_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
}

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

  const gatewayUrl = getGatewayUrl();
  const targetUrl = `${gatewayUrl}${url}`;

  // Forward cookie header so the IB gateway recognises the session
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (req.headers.cookie) {
    headers['Cookie'] = req.headers.cookie;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.env as any).NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const upstream = await fetch(targetUrl, fetchInit);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.env as any).NODE_TLS_REJECT_UNAUTHORIZED = '1';

    // Forward Set-Cookie so the browser session stays in sync
    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    const setCookie = upstream.headers.get('set-cookie');
    const responseHeaders: Record<string, string | string[]> = { 'Content-Type': contentType };
    if (setCookie) responseHeaders['Set-Cookie'] = setCookie;

    const responseBody = await upstream.text();
    res.writeHead(upstream.status, responseHeaders);
    res.end(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 502, `IB gateway proxy error: ${message}. Is the IB Client Portal Gateway running?`);
  }
}

export function ibProxyPlugin(): Plugin {
  return {
    name: 'ib-proxy',
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
