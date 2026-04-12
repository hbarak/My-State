import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HttpPort } from '@my-stocks/domain';
import { IBApiClient } from '../src/ib/IBApiClient';

function makeHttp(responses: Record<string, unknown>): HttpPort & { calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = [];
  return {
    calls,
    async request(req) {
      calls.push({ url: req.url, method: req.method });
      const key = `${req.method} ${req.url}`;
      // Match by URL suffix for flexibility
      const match = Object.entries(responses).find(([k]) => req.url.includes(k));
      if (match) {
        return { status: 200, body: match[1] };
      }
      return { status: 404, body: { error: 'not found' } };
    },
  };
}

describe('IBApiClient', () => {
  const BASE = '/api/ib';
  let http: ReturnType<typeof makeHttp>;
  let client: IBApiClient;

  beforeEach(() => {
    http = makeHttp({});
    client = new IBApiClient(http, BASE);
  });

  describe('checkAuthStatus', () => {
    it('returns auth status from gateway', async () => {
      http = makeHttp({
        '/iserver/auth/status': { authenticated: true, competing: false, connected: true },
      });
      client = new IBApiClient(http, BASE);

      const status = await client.checkAuthStatus();

      expect(status.authenticated).toBe(true);
      expect(status.competing).toBe(false);
      expect(status.connected).toBe(true);
    });

    it('throws IBApiError with gateway_unavailable when gateway unreachable', async () => {
      const failHttp: HttpPort = {
        async request() { throw new Error('ECONNREFUSED'); },
      };
      client = new IBApiClient(failHttp, BASE);

      await expect(client.checkAuthStatus()).rejects.toMatchObject({
        type: 'gateway_unavailable',
      });
    });

    it('throws IBApiError with not_authenticated when 401', async () => {
      const http401: HttpPort = {
        async request() { return { status: 401, body: { error: 'not authenticated' } }; },
      };
      client = new IBApiClient(http401, BASE);

      await expect(client.checkAuthStatus()).rejects.toMatchObject({
        type: 'not_authenticated',
      });
    });
  });

  describe('tickle', () => {
    it('calls POST /tickle', async () => {
      http = makeHttp({ '/tickle': { session: 'abc123', ssoExpires: 9999999999000, collission: false, userId: 12345, iserver: { authStatus: { authenticated: true, competing: false, connected: true } } } });
      client = new IBApiClient(http, BASE);

      await client.tickle();

      expect(http.calls.some((c) => c.url.includes('/tickle') && c.method === 'POST')).toBe(true);
    });
  });

  describe('fetchAccounts', () => {
    it('returns parsed accounts list', async () => {
      http = makeHttp({
        '/portfolio/accounts': [
          { id: 'U10807583', currency: 'USD', type: 'INDIVIDUAL', desc: 'My Account' },
        ],
      });
      client = new IBApiClient(http, BASE);

      const accounts = await client.fetchAccounts();

      expect(accounts).toHaveLength(1);
      expect(accounts[0].id).toBe('U10807583');
      expect(accounts[0].currency).toBe('USD');
    });

    it('returns empty array when no accounts', async () => {
      http = makeHttp({ '/portfolio/accounts': [] });
      client = new IBApiClient(http, BASE);

      const accounts = await client.fetchAccounts();
      expect(accounts).toEqual([]);
    });
  });

  describe('fetchPositions', () => {
    it('returns positions for a single page', async () => {
      // Page 0 has data, page 1 is empty → stop
      const http2: HttpPort & { calls: Array<{ url: string }> } = {
        calls: [],
        async request(req) {
          this.calls.push({ url: req.url });
          if (req.url.includes('/positions/0')) {
            return {
              status: 200,
              body: [
                { acctId: 'U10807583', conid: 265598, contractDesc: 'AAPL (NASDAQ)', position: 100, mktPrice: 182.5, mktValue: 18250, avgCost: 150, avgPrice: 150, unrealizedPnl: 3250, currency: 'USD', assetClass: 'STK', ticker: 'AAPL' },
              ],
            };
          }
          if (req.url.includes('/positions/1')) {
            return { status: 200, body: [] };
          }
          return { status: 404, body: {} };
        },
      };
      client = new IBApiClient(http2, BASE);

      const positions = await client.fetchPositions('U10807583');

      expect(positions).toHaveLength(1);
      expect(positions[0].conid).toBe(265598);
      expect(positions[0].ticker).toBe('AAPL');
    });

    it('fetches multiple pages until empty', async () => {
      let callCount = 0;
      const httpPaged: HttpPort = {
        async request(req) {
          callCount++;
          if (req.url.includes('/positions/0')) {
            return { status: 200, body: [{ acctId: 'U1', conid: 1, contractDesc: 'A', position: 10, mktPrice: 100, mktValue: 1000, avgCost: 90, avgPrice: 90, unrealizedPnl: 100, currency: 'USD', assetClass: 'STK' }] };
          }
          if (req.url.includes('/positions/1')) {
            return { status: 200, body: [{ acctId: 'U1', conid: 2, contractDesc: 'B', position: 20, mktPrice: 200, mktValue: 4000, avgCost: 180, avgPrice: 180, unrealizedPnl: 400, currency: 'USD', assetClass: 'STK' }] };
          }
          return { status: 200, body: [] };
        },
      };
      client = new IBApiClient(httpPaged, BASE);

      const positions = await client.fetchPositions('U1');

      expect(positions).toHaveLength(2);
      expect(positions[0].conid).toBe(1);
      expect(positions[1].conid).toBe(2);
    });
  });

  describe('fetchMarketData', () => {
    it('calls snapshot twice (pre-flight then actual) and returns second result', async () => {
      let callCount = 0;
      const httpSnapshot: HttpPort = {
        async request() {
          callCount++;
          if (callCount === 1) {
            // Pre-flight — may return empty or partial data
            return { status: 200, body: [{ conid: 265598 }] };
          }
          // Actual data
          return { status: 200, body: [{ conid: 265598, '31': '182.50', '55': 'AAPL' }] };
        },
      };
      client = new IBApiClient(httpSnapshot, BASE);

      const snapshots = await client.fetchMarketData([265598]);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].conid).toBe(265598);
      expect(snapshots[0]['31']).toBe('182.50');
      expect(callCount).toBe(2);
    });

    it('batches conids in groups of 100', async () => {
      const calls: string[] = [];
      const httpBatch: HttpPort = {
        async request(req) {
          calls.push(req.url);
          return { status: 200, body: [] };
        },
      };
      client = new IBApiClient(httpBatch, BASE);

      const conids = Array.from({ length: 150 }, (_, i) => i + 1);
      await client.fetchMarketData(conids);

      // 150 conids → 2 batches × 2 calls each (pre-flight + actual) = 4 calls
      const snapshotCalls = calls.filter((u) => u.includes('marketdata/snapshot'));
      expect(snapshotCalls).toHaveLength(4);
    });

    it('returns empty array for empty input', async () => {
      const snapshots = await client.fetchMarketData([]);
      expect(snapshots).toEqual([]);
    });
  });
});
