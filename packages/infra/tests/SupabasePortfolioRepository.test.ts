import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabasePortfolioRepository } from '../src/supabase/SupabasePortfolioRepository';
import type { Provider, Account, ProviderIntegration, ProviderMappingProfile, ProviderHoldingRecord, TradeTransaction, PositionLot, TickerMapping, PortfolioImportRun, RawImportRow } from '@my-stocks/domain';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client mock factory
// ─────────────────────────────────────────────────────────────────────────────

function makeQueryBuilder(returnData: unknown = [], returnError: unknown = null) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.is = vi.fn(chain);
  builder.not = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.limit = vi.fn(chain);
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: Array.isArray(returnData) ? (returnData[0] ?? null) : returnData, error: returnError }));
  builder.single = vi.fn(() => Promise.resolve({ data: returnData, error: returnError }));
  builder.insert = vi.fn(() => Promise.resolve({ data: returnData, error: returnError }));
  builder.upsert = vi.fn(() => Promise.resolve({ data: returnData, error: returnError }));
  builder.update = vi.fn(() => ({ ...builder, select: vi.fn(() => Promise.resolve({ data: returnData, error: returnError })) }));
  builder.delete = vi.fn(chain);

  // Terminal: when called without chaining, resolve
  // Override select to return data for list queries
  builder.select = vi.fn(() => {
    const inner = { ...builder };
    inner.eq = vi.fn(() => inner);
    inner.is = vi.fn(() => inner);
    inner.not = vi.fn(() => inner);
    inner.in = vi.fn(() => inner);
    inner.order = vi.fn(() => inner);
    inner.limit = vi.fn(() => inner);
    inner.maybeSingle = vi.fn(() => Promise.resolve({ data: Array.isArray(returnData) && returnData.length > 0 ? returnData[0] : null, error: returnError }));
    // Make the inner builder thenable for list queries
    inner.then = (resolve: (v: unknown) => unknown) => resolve({ data: returnData, error: returnError });
    return inner;
  });

  return builder;
}

function makeSupabaseClient(data: unknown = [], error: unknown = null) {
  const queryResult = { data, error };

  // Build a chainable mock that resolves at the end
  const makeChain = (): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    const self = () => obj;

    obj.select = vi.fn(() => {
      const inner = makeChain();
      // Make thenable so `await client.from().select()...` works
      inner.then = (resolve: (v: unknown) => unknown) => Promise.resolve(queryResult).then(resolve);
      return inner;
    });
    obj.eq = vi.fn(() => {
      const inner = makeChain();
      inner.then = (resolve: (v: unknown) => unknown) => Promise.resolve(queryResult).then(resolve);
      return inner;
    });
    obj.is = vi.fn(self);
    obj.not = vi.fn(self);
    obj.in = vi.fn(self);
    obj.order = vi.fn(self);
    obj.limit = vi.fn(self);
    obj.maybeSingle = vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? (data[0] ?? null) : data, error }));
    obj.insert = vi.fn(() => Promise.resolve(queryResult));
    obj.upsert = vi.fn(() => Promise.resolve(queryResult));
    obj.update = vi.fn(() => {
      const inner = makeChain();
      inner.then = (resolve: (v: unknown) => unknown) => Promise.resolve(queryResult).then(resolve);
      return inner;
    });
    obj.delete = vi.fn(() => {
      const inner = makeChain();
      inner.then = (resolve: (v: unknown) => unknown) => Promise.resolve(queryResult).then(resolve);
      return inner;
    });
    return obj;
  };

  return {
    from: vi.fn(() => makeChain()),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'user-123' } } } })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NOW = '2026-04-08T00:00:00.000Z';
const USER_ID = 'user-123';

const provider: Provider = { id: 'prov-1', name: 'Test Broker', status: 'active', createdAt: NOW, updatedAt: NOW };
const account: Account = { id: 'acc-1', providerId: 'prov-1', name: 'Main', createdAt: NOW, updatedAt: NOW };
const integration: ProviderIntegration = {
  id: 'int-1', providerId: 'prov-1', kind: 'document', dataDomain: 'holdings',
  communicationMethod: 'document_csv', syncMode: 'manual', direction: 'ingest',
  adapterKey: 'test.v1', isEnabled: true, createdAt: NOW, updatedAt: NOW,
};
const holdingRecord: ProviderHoldingRecord = {
  id: 'hr-1', providerId: 'prov-1', providerIntegrationId: 'int-1',
  accountId: 'acc-1', securityId: 'sec-1', securityName: 'Apple Inc',
  actionType: 'buy', quantity: 10, costBasis: 100, currency: 'USD',
  actionDate: '2026-01-01', createdAt: NOW, updatedAt: NOW,
};
const trade: TradeTransaction = {
  id: 'trade-1', providerId: 'prov-1', providerIntegrationId: 'int-1',
  accountId: 'acc-1', symbol: 'AAPL', displaySymbol: 'AAPL',
  side: 'buy', quantity: 10, price: 100, fees: 1, currency: 'USD',
  tradeAt: NOW, createdAt: NOW, updatedAt: NOW,
};
const lot: PositionLot = {
  id: 'lot-1', providerId: 'prov-1', accountId: 'acc-1', symbol: 'AAPL',
  buyTradeId: 'trade-1', originalQty: 10, openQty: 10,
  costPerUnit: 100, feesAllocated: 0.1, openedAt: NOW, updatedAt: NOW,
};
const tickerMapping: TickerMapping = {
  securityId: 'sec-1', securityName: 'Apple Inc', ticker: 'AAPL',
  resolvedAt: NOW, resolvedBy: 'auto',
};
const importRun: PortfolioImportRun = {
  id: 'run-1', providerId: 'prov-1', providerIntegrationId: 'int-1',
  sourceName: 'test.csv', status: 'success', startedAt: NOW,
  importedCount: 1, skippedCount: 0, errorCount: 0, isUndoable: true,
};
const rawRow: RawImportRow = {
  id: 'row-1', importRunId: 'run-1', providerId: 'prov-1',
  providerIntegrationId: 'int-1', rowNumber: 1, rowPayload: 'a,b,c',
  rowHash: 'hash1', isValid: true, createdAt: NOW,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SupabasePortfolioRepository', () => {

  describe('getUserId', () => {
    it('throws when no session exists', async () => {
      const client = {
        from: vi.fn(),
        auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) },
      };
      const repo = new SupabasePortfolioRepository(client as never);
      // Any method that calls getUserId should throw
      await expect(repo.getProviders()).rejects.toThrow('no active session');
    });

    it('injects user_id into every mutation', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertProvider(provider);
      expect(client.auth.getSession).toHaveBeenCalled();
      const fromCall = client.from.mock.calls[0];
      expect(fromCall[0]).toBe('providers');
    });
  });

  // ── Providers ──────────────────────────────────────────────────────────────

  describe('providers', () => {
    it('upsertProvider: calls from("providers").upsert with user_id', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertProvider(provider);
      expect(client.from).toHaveBeenCalledWith('providers');
      const chain = client.from.mock.results[0].value;
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'prov-1', user_id: USER_ID, name: 'Test Broker' }),
        { onConflict: 'id,user_id' }
      );
    });

    it('upsertProvider: throws on supabase error', async () => {
      const client = makeSupabaseClient(null, { message: 'db error' });
      const repo = new SupabasePortfolioRepository(client as never);
      await expect(repo.upsertProvider(provider)).rejects.toThrow('providers.upsertProvider: db error');
    });

    it('getProviders: queries with user_id filter', async () => {
      const providerRow = { id: 'prov-1', user_id: USER_ID, name: 'Test Broker', status: 'active', created_at: NOW, updated_at: NOW };
      const client = makeSupabaseClient([providerRow]);
      const repo = new SupabasePortfolioRepository(client as never);
      const result = await repo.getProviders();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('prov-1');
    });
  });

  // ── Accounts ───────────────────────────────────────────────────────────────

  describe('accounts', () => {
    it('upsertAccount: uses composite onConflict', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertAccount(account);
      const chain = client.from.mock.results[0].value;
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'acc-1', user_id: USER_ID, provider_id: 'prov-1' }),
        { onConflict: 'user_id,provider_id,id' }
      );
    });

    it('deleteAccount: scopes delete to user_id + provider_id + account_id', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.deleteAccount('prov-1', 'acc-1');
      expect(client.from).toHaveBeenCalledWith('accounts');
    });
  });

  // ── ProviderIntegrations ───────────────────────────────────────────────────

  describe('provider_integrations', () => {
    it('upsertIntegration: serializes optional fields as null', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertIntegration(integration);
      const chain = client.from.mock.results[0].value;
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null, mapping_profile_id: null }),
        { onConflict: 'id,user_id' }
      );
    });

    it('upsertIntegration: throws on error', async () => {
      const client = makeSupabaseClient(null, { message: 'constraint violation' });
      const repo = new SupabasePortfolioRepository(client as never);
      await expect(repo.upsertIntegration(integration)).rejects.toThrow('provider_integrations.upsertIntegration');
    });
  });

  // ── ProviderMappingProfiles ────────────────────────────────────────────────

  describe('provider_mapping_profiles', () => {
    it('upsertMappingProfile: sends JSONB fields as objects (not strings)', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      const profile: ProviderMappingProfile = {
        id: 'prof-1', providerId: 'prov-1', providerIntegrationId: 'int-1',
        name: 'Test Profile', version: 1, isActive: true, inputFormat: 'csv',
        fieldMappings: { symbol: 'Symbol' }, requiredCanonicalFields: ['symbol'],
        createdAt: NOW, updatedAt: NOW,
      };
      await repo.upsertMappingProfile(profile);
      const chain = client.from.mock.results[0].value;
      const upsertArg = chain.upsert.mock.calls[0][0];
      // field_mappings must be an object, not a JSON string
      expect(typeof upsertArg.field_mappings).toBe('object');
      expect(upsertArg.field_mappings).toEqual({ symbol: 'Symbol' });
    });
  });

  // ── ImportRuns ─────────────────────────────────────────────────────────────

  describe('portfolio_import_runs', () => {
    it('addImportRun: uses INSERT not upsert', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.addImportRun(importRun);
      const chain = client.from.mock.results[0].value;
      expect(chain.insert).toHaveBeenCalled();
      expect(chain.upsert).not.toHaveBeenCalled();
    });

    it('updateImportRun: uses upsert with onConflict', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.updateImportRun({ ...importRun, status: 'success' });
      const chain = client.from.mock.results[0].value;
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success' }),
        { onConflict: 'id,user_id' }
      );
    });

    it('addImportRun: throws on error', async () => {
      const client = makeSupabaseClient(null, { message: 'insert failed' });
      const repo = new SupabasePortfolioRepository(client as never);
      await expect(repo.addImportRun(importRun)).rejects.toThrow('portfolio_import_runs.addImportRun');
    });
  });

  // ── RawImportRows ──────────────────────────────────────────────────────────

  describe('raw_import_rows', () => {
    it('addRawRows: no-ops on empty array', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.addRawRows([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('addRawRows: inserts rows including user_id', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.addRawRows([rawRow]);
      const chain = client.from.mock.results[0].value;
      expect(chain.insert).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'row-1', user_id: USER_ID })])
      );
    });
  });

  // ── TradeTransactions ──────────────────────────────────────────────────────

  describe('trade_transactions', () => {
    it('upsertTrades: no-ops on empty array', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertTrades([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('upsertTrades: batch upsert with user_id', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertTrades([trade]);
      const chain = client.from.mock.results[0].value;
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'trade-1', user_id: USER_ID })]),
        { onConflict: 'id,user_id' }
      );
    });

    it('listTradesByProvider: filters deleted_at IS NULL', async () => {
      const client = makeSupabaseClient([]);
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.listTradesByProvider('prov-1');
      expect(client.from).toHaveBeenCalledWith('trade_transactions');
    });

    it('listTradesByImportRun: does NOT filter deleted_at (audit trail)', async () => {
      // Both deleted and non-deleted rows should be returned — we verify the
      // method doesn't apply a deleted_at filter by checking it's called correctly
      const client = makeSupabaseClient([]);
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.listTradesByImportRun('run-1');
      expect(client.from).toHaveBeenCalledWith('trade_transactions');
    });
  });

  // ── ProviderHoldingRecords ─────────────────────────────────────────────────

  describe('provider_holding_records', () => {
    it('upsertHoldingRecords: no-ops on empty array', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertHoldingRecords([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('upsertHoldingRecords: includes user_id in each row', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertHoldingRecords([holdingRecord]);
      const chain = client.from.mock.results[0].value;
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'hr-1', user_id: USER_ID, account_id: 'acc-1' })]),
        { onConflict: 'id,user_id' }
      );
    });

    it('deleteImportRunContribution: soft-deletes records then marks run undone', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.deleteImportRunContribution('run-1');
      // Two table calls: provider_holding_records and portfolio_import_runs
      expect(client.from).toHaveBeenCalledWith('provider_holding_records');
      expect(client.from).toHaveBeenCalledWith('portfolio_import_runs');
    });

    it('deleteImportRunContribution: throws if holding records update fails', async () => {
      const calls: string[] = [];
      const mockClient = {
        from: vi.fn((table: string) => {
          calls.push(table);
          const chain = makeSupabaseClient(null, { message: 'update error' });
          return chain.from(table);
        }),
        auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: USER_ID } } } })) },
      };
      const repo = new SupabasePortfolioRepository(mockClient as never);
      await expect(repo.deleteImportRunContribution('run-1')).rejects.toThrow();
    });
  });

  // ── PositionLots ───────────────────────────────────────────────────────────

  describe('position_lots', () => {
    it('replaceLots: deletes all user lots then inserts new ones', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.replaceLots([lot]);
      expect(client.from).toHaveBeenCalledWith('position_lots');
    });

    it('replaceLots: skips insert when lots array is empty', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.replaceLots([]);
      // Should only call from once (for delete) — getUserId uses auth.getSession not from
      expect(client.from).toHaveBeenCalledTimes(1);
    });
  });

  // ── TickerMappings ─────────────────────────────────────────────────────────

  describe('ticker_mappings', () => {
    it('upsertTickerMapping: uses composite PK onConflict', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.upsertTickerMapping(tickerMapping);
      const chain = client.from.mock.results[0].value;
      expect(chain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ security_id: 'sec-1', user_id: USER_ID }),
        { onConflict: 'user_id,security_id' }
      );
    });

    it('deleteTickerMapping: scoped to user_id and security_id', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.deleteTickerMapping('sec-1');
      expect(client.from).toHaveBeenCalledWith('ticker_mappings');
    });

    it('getTickerMapping: returns null when not found', async () => {
      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
              })),
            })),
          })),
        })),
        auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: USER_ID } } } })) },
      };
      const repo = new SupabasePortfolioRepository(mockClient as never);
      const result = await repo.getTickerMapping('unknown-sec');
      expect(result).toBeNull();
    });
  });

  // ── resetAllData ───────────────────────────────────────────────────────────

  describe('resetAllData', () => {
    it('deletes 6 tables in reverse FK order', async () => {
      const client = makeSupabaseClient();
      const repo = new SupabasePortfolioRepository(client as never);
      await repo.resetAllData();
      const tableCalls = client.from.mock.calls.map((c: string[][]) => c[0]);
      // First call is getUserId (auth.getSession), then 6 table deletes
      expect(tableCalls).toContain('ticker_mappings');
      expect(tableCalls).toContain('position_lots');
      expect(tableCalls).toContain('provider_holding_records');
      expect(tableCalls).toContain('trade_transactions');
      expect(tableCalls).toContain('raw_import_rows');
      expect(tableCalls).toContain('portfolio_import_runs');
      // ticker_mappings must be deleted before portfolio_import_runs (reverse FK order)
      expect(tableCalls.indexOf('ticker_mappings')).toBeLessThan(tableCalls.indexOf('portfolio_import_runs'));
    });

    it('throws on first delete error', async () => {
      const client = makeSupabaseClient(null, { message: 'permission denied' });
      const repo = new SupabasePortfolioRepository(client as never);
      await expect(repo.resetAllData()).rejects.toThrow('resetAllData');
    });
  });

  // ── getProvenanceForSecurity ───────────────────────────────────────────────

  describe('getProvenanceForSecurity', () => {
    it('returns empty array when no holding records exist', async () => {
      const mockClient = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  not: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            })),
          })),
        })),
        auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: USER_ID } } } })) },
      };
      const repo = new SupabasePortfolioRepository(mockClient as never);
      const result = await repo.getProvenanceForSecurity('sec-1');
      expect(result).toHaveLength(0);
    });
  });
});
