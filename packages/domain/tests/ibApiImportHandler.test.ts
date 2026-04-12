import { describe, it, expect } from 'vitest';
import { IBApiImportHandler } from '../src/services/IBApiImportHandler';
import type { IBPosition, ProviderHoldingRecord } from '../src/types';

const PROVIDER_ID = 'provider-ib';
const INTEGRATION_ID = 'ib-api-holdings';
const ACCOUNT_ID = 'U10807583';
const IMPORT_RUN_ID = 'run_ib_001';

function makePosition(overrides: Partial<IBPosition> = {}): IBPosition {
  return {
    acctId: ACCOUNT_ID,
    conid: 265598,
    contractDesc: 'AAPL (NASDAQ)',
    position: 100,
    mktPrice: 182.5,
    mktValue: 18250,
    avgCost: 150.0,
    avgPrice: 150.0,
    unrealizedPnl: 3250,
    currency: 'USD',
    assetClass: 'STK',
    ticker: 'AAPL',
    fullName: 'APPLE INC',
    ...overrides,
  };
}

describe('IBApiImportHandler', () => {
  const handler = new IBApiImportHandler();

  describe('mapPositionsToHoldingRecords', () => {
    it('maps a stock position to a ProviderHoldingRecord', () => {
      const positions = [makePosition()];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records).toHaveLength(1);
      const r = records[0];
      expect(r.providerId).toBe(PROVIDER_ID);
      expect(r.providerIntegrationId).toBe(INTEGRATION_ID);
      expect(r.accountId).toBe(ACCOUNT_ID);
      expect(r.importRunId).toBe(IMPORT_RUN_ID);
      expect(r.securityId).toBe('265598');
      expect(r.securityName).toBe('APPLE INC');
      expect(r.actionType).toBe('hold');
      expect(r.quantity).toBe(100);
      expect(r.costBasis).toBe(150.0);
      expect(r.currency).toBe('USD');
      expect(r.currentPrice).toBe(182.5);
    });

    it('uses contractDesc as securityName when fullName is missing', () => {
      const positions = [makePosition({ fullName: undefined })];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records[0].securityName).toBe('AAPL (NASDAQ)');
    });

    it('converts conid to string for securityId', () => {
      const positions = [makePosition({ conid: 756733 })];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records[0].securityId).toBe('756733');
    });

    it('filters out non-STK positions (options, futures, cash)', () => {
      const positions = [
        makePosition({ assetClass: 'STK' }),
        makePosition({ conid: 100, assetClass: 'OPT', contractDesc: 'AAPL Call' }),
        makePosition({ conid: 200, assetClass: 'FUT', contractDesc: 'ES Future' }),
        makePosition({ conid: 300, assetClass: 'CASH', contractDesc: 'USD.ILS' }),
        makePosition({ conid: 400, assetClass: 'BOND', contractDesc: 'US Treasury' }),
      ];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records).toHaveLength(1);
      expect(records[0].securityId).toBe('265598');
    });

    it('filters out zero-quantity positions (closed)', () => {
      const positions = [
        makePosition({ position: 0 }),
        makePosition({ conid: 999, position: 50 }),
      ];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records).toHaveLength(1);
      expect(records[0].securityId).toBe('999');
    });

    it('handles short positions (negative quantity)', () => {
      const positions = [makePosition({ position: -50, mktPrice: 180, mktValue: -9000 })];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records).toHaveLength(1);
      expect(records[0].quantity).toBe(-50);
    });

    it('returns empty array for empty positions', () => {
      const records = handler.mapPositionsToHoldingRecords({
        positions: [],
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records).toEqual([]);
    });

    it('maps multiple positions correctly', () => {
      const positions = [
        makePosition({ conid: 265598, ticker: 'AAPL', fullName: 'APPLE INC', position: 100, mktPrice: 182.5, avgCost: 150 }),
        makePosition({ conid: 756733, ticker: 'MSFT', fullName: 'MICROSOFT CORP', position: 50, mktPrice: 420, avgCost: 380, currency: 'USD' }),
      ];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records).toHaveLength(2);
      expect(records[0].securityId).toBe('265598');
      expect(records[1].securityId).toBe('756733');
      expect(records[1].quantity).toBe(50);
      expect(records[1].currentPrice).toBe(420);
    });

    it('sets actionDate to today', () => {
      const positions = [makePosition()];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      const today = new Date().toISOString().slice(0, 10);
      expect(records[0].actionDate).toBe(today);
    });

    it('sets id, createdAt, updatedAt on each record', () => {
      const positions = [makePosition()];
      const records = handler.mapPositionsToHoldingRecords({
        positions,
        providerId: PROVIDER_ID,
        providerIntegrationId: INTEGRATION_ID,
        accountId: ACCOUNT_ID,
        importRunId: IMPORT_RUN_ID,
      });

      expect(records[0].id).toBeTruthy();
      expect(records[0].createdAt).toBeTruthy();
      expect(records[0].updatedAt).toBeTruthy();
    });
  });
});
