import { describe, it, expect, beforeEach } from 'vitest';
import type { HttpPort } from '@my-stocks/domain';
import { ClientAMApiClient } from '../src/clientam/ClientAMApiClient';

function makeHttp(
  handler: (req: { url: string; method: string }) => { status: number; body: unknown },
): HttpPort {
  return {
    async request(req) {
      return handler({ url: req.url, method: req.method });
    },
  };
}

describe('ClientAMApiClient', () => {
  const BASE = '/api/clientam';

  describe('checkSession', () => {
    it('returns authenticated when portfolio2/accounts returns data', async () => {
      const http = makeHttp(() => ({
        status: 200,
        body: [{ id: 'U10807583', accountId: 'U10807583', currency: 'USD', type: 'INDIVIDUAL' }],
      }));
      const client = new ClientAMApiClient(http, BASE);

      const result = await client.checkSession();

      expect(result.authenticated).toBe(true);
    });

    it('returns not authenticated on 401', async () => {
      const http = makeHttp(() => ({ status: 401, body: { error: 'unauthorized' } }));
      const client = new ClientAMApiClient(http, BASE);

      const result = await client.checkSession();

      expect(result.authenticated).toBe(false);
    });

    it('returns not authenticated on empty array', async () => {
      const http = makeHttp(() => ({ status: 200, body: [] }));
      const client = new ClientAMApiClient(http, BASE);

      const result = await client.checkSession();

      expect(result.authenticated).toBe(false);
    });

    it('returns not authenticated on network error', async () => {
      const http: HttpPort = {
        async request() { throw new Error('ECONNREFUSED'); },
      };
      const client = new ClientAMApiClient(http, BASE);

      const result = await client.checkSession();

      expect(result.authenticated).toBe(false);
    });
  });

  describe('fetchAccounts', () => {
    it('normalizes ClientAM account response to IBAccount shape', async () => {
      const http = makeHttp(() => ({
        status: 200,
        body: [
          {
            id: 'U10807583',
            accountId: 'U10807583',
            accountVan: 'U10807583',
            accountTitle: 'Barak Hartman',
            displayName: 'Barak Hartman',
            accountAlias: null,
            currency: 'USD',
            type: 'INDIVIDUAL',
            tradingType: 'STKMRGN',
            desc: 'U10807583',
          },
        ],
      }));
      const client = new ClientAMApiClient(http, BASE);

      const accounts = await client.fetchAccounts();

      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toEqual({
        id: 'U10807583',
        currency: 'USD',
        type: 'INDIVIDUAL',
        desc: 'Barak Hartman',
      });
    });

    it('uses accountId field when id is missing', async () => {
      const http = makeHttp(() => ({
        status: 200,
        body: [{ accountId: 'U999', currency: 'EUR', type: 'JOINT', displayName: 'Joint Acct' }],
      }));
      const client = new ClientAMApiClient(http, BASE);

      const accounts = await client.fetchAccounts();

      expect(accounts[0].id).toBe('U999');
      expect(accounts[0].desc).toBe('Joint Acct');
    });

    it('falls back to desc when displayName and accountTitle are missing', async () => {
      const http = makeHttp(() => ({
        status: 200,
        body: [{ id: 'U1', currency: 'USD', type: 'INDIVIDUAL', desc: 'U1' }],
      }));
      const client = new ClientAMApiClient(http, BASE);

      const accounts = await client.fetchAccounts();

      expect(accounts[0].desc).toBe('U1');
    });

    it('returns empty array on 401', async () => {
      const http = makeHttp(() => ({ status: 401, body: {} }));
      const client = new ClientAMApiClient(http, BASE);

      await expect(client.fetchAccounts()).rejects.toMatchObject({
        type: 'not_authenticated',
      });
    });

    it('throws api_error on non-401 HTTP error', async () => {
      const http = makeHttp(() => ({ status: 500, body: {} }));
      const client = new ClientAMApiClient(http, BASE);

      await expect(client.fetchAccounts()).rejects.toMatchObject({
        type: 'api_error',
      });
    });
  });

  describe('fetchPositions', () => {
    it('normalizes ClientAM position response to IBPosition shape', async () => {
      const http = makeHttp((req) => {
        if (req.url.includes('/portfolio2/U10807583/positions')) {
          return {
            status: 200,
            body: [
              {
                acctId: 'U10807583',
                model: '',
                position: 28,
                conid: 76792991,
                avgCost: 407.880607,
                avgPrice: 407.880607,
                currency: 'USD',
                description: 'TSLA',
                marketPrice: 351.299988,
                marketValue: 9836.399658,
                mktPrice: 351.299988,
                mktValue: 9836.399658,
                realizedPnl: 0,
                secType: 'STK',
                unrealizedPnl: -1584.257342,
                contractDesc: 'TSLA',
                assetClass: 'STK',
                sector: 'Consumer, Cyclical',
                group: 'Auto Manufacturers',
              },
            ],
          };
        }
        return { status: 404, body: {} };
      });
      const client = new ClientAMApiClient(http, BASE);

      const positions = await client.fetchPositions('U10807583');

      expect(positions).toHaveLength(1);
      expect(positions[0]).toMatchObject({
        acctId: 'U10807583',
        conid: 76792991,
        contractDesc: 'TSLA',
        position: 28,
        mktPrice: 351.299988,
        mktValue: 9836.399658,
        avgCost: 407.880607,
        avgPrice: 407.880607,
        unrealizedPnl: -1584.257342,
        currency: 'USD',
        assetClass: 'STK',
      });
    });

    it('uses description as ticker when ticker field is missing', async () => {
      const http = makeHttp(() => ({
        status: 200,
        body: [
          {
            acctId: 'U1',
            conid: 123,
            contractDesc: 'AAPL',
            description: 'AAPL',
            position: 10,
            mktPrice: 180,
            mktValue: 1800,
            marketPrice: 180,
            marketValue: 1800,
            avgCost: 150,
            avgPrice: 150,
            unrealizedPnl: 300,
            currency: 'USD',
            assetClass: 'STK',
            secType: 'STK',
          },
        ],
      }));
      const client = new ClientAMApiClient(http, BASE);

      const positions = await client.fetchPositions('U1');

      expect(positions[0].ticker).toBe('AAPL');
    });

    it('returns all positions in single call (no pagination)', async () => {
      const calls: string[] = [];
      const http: HttpPort = {
        async request(req) {
          calls.push(req.url);
          return {
            status: 200,
            body: [
              { acctId: 'U1', conid: 1, contractDesc: 'A', description: 'A', position: 10, mktPrice: 100, mktValue: 1000, marketPrice: 100, marketValue: 1000, avgCost: 90, avgPrice: 90, unrealizedPnl: 100, currency: 'USD', assetClass: 'STK', secType: 'STK' },
              { acctId: 'U1', conid: 2, contractDesc: 'B', description: 'B', position: 20, mktPrice: 200, mktValue: 4000, marketPrice: 200, marketValue: 4000, avgCost: 180, avgPrice: 180, unrealizedPnl: 400, currency: 'USD', assetClass: 'STK', secType: 'STK' },
            ],
          };
        },
      };
      const client = new ClientAMApiClient(http, BASE);

      const positions = await client.fetchPositions('U1');

      expect(positions).toHaveLength(2);
      expect(calls).toHaveLength(1); // Single call, no pagination
    });

    it('returns empty array for empty response', async () => {
      const http = makeHttp(() => ({ status: 200, body: [] }));
      const client = new ClientAMApiClient(http, BASE);

      const positions = await client.fetchPositions('U1');
      expect(positions).toEqual([]);
    });

    it('throws not_authenticated on 401', async () => {
      const http = makeHttp(() => ({ status: 401, body: {} }));
      const client = new ClientAMApiClient(http, BASE);

      await expect(client.fetchPositions('U1')).rejects.toMatchObject({
        type: 'not_authenticated',
      });
    });
  });
});
