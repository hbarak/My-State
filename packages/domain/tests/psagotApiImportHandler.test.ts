import { describe, expect, it } from 'vitest';
import { PsagotApiImportHandler } from '../src/services/PsagotApiImportHandler';
import type { PsagotBalance, ProviderHoldingRecord } from '../src/types';

const PROVIDER_ID = 'provider-psagot';
const INTEGRATION_ID = 'psagot-api-holdings';
const ACCOUNT_ID = '150-190500';
const RUN_ID = 'run-abc';

function makeBalance(overrides: Partial<PsagotBalance> = {}): PsagotBalance {
  return {
    equityNumber: '5130919',
    quantity: 100,
    lastRate: 9741,
    averagePrice: 8500,
    marketValue: 974100,
    marketValueNis: 974100,
    profitLoss: 124100,
    profitLossNis: 124100,
    profitLossPct: 14.6,
    portfolioWeight: 45.2,
    currencyCode: 'ILS',
    source: 'TA',
    subAccount: '0',
    hebName: 'בנק לאומי',
    ...overrides,
  };
}

function mapOne(balance: PsagotBalance, existingRecords: ProviderHoldingRecord[] = []): ProviderHoldingRecord[] {
  const handler = new PsagotApiImportHandler();
  return handler.mapBalancesToHoldingRecords({
    balances: [balance],
    providerId: PROVIDER_ID,
    providerIntegrationId: INTEGRATION_ID,
    accountId: ACCOUNT_ID,
    importRunId: RUN_ID,
    existingRecords,
    agorotConversion: true,
  });
}

describe('PsagotApiImportHandler', () => {
  // ── Field Mapping ──

  it('M1: maps equityNumber to securityId', () => {
    const records = mapOne(makeBalance({ equityNumber: '5130919' }));
    expect(records[0].securityId).toBe('5130919');
  });

  it('M2: maps quantity (OnlineNV) to quantity', () => {
    const records = mapOne(makeBalance({ quantity: 250 }));
    expect(records[0].quantity).toBe(250);
  });

  it('M3: maps averagePrice to costBasis with agorot conversion for ILS', () => {
    const records = mapOne(makeBalance({ averagePrice: 8500, currencyCode: 'ILS' }));
    expect(records[0].costBasis).toBe(85); // 8500 agorot = 85 ILS
  });

  it('M4: maps currencyCode to currency', () => {
    const records = mapOne(makeBalance({ currencyCode: 'ILS' }));
    expect(records[0].currency).toBe('ILS');
  });

  it('M5: maps USD currency positions without agorot conversion', () => {
    const handler = new PsagotApiImportHandler();
    const records = handler.mapBalancesToHoldingRecords({
      balances: [makeBalance({ currencyCode: 'USD', averagePrice: 150, lastRate: 160 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_ID,
      importRunId: RUN_ID,
      existingRecords: [],
      agorotConversion: true,
    });
    expect(records[0].costBasis).toBe(150); // USD: no conversion
    expect(records[0].currentPrice).toBe(160);
  });

  it('M6: maps ILS agorot values — costBasis and currentPrice converted', () => {
    const records = mapOne(makeBalance({ averagePrice: 4550, lastRate: 4700, currencyCode: 'ILS' }));
    expect(records[0].costBasis).toBe(45.5);
    expect(records[0].currentPrice).toBe(47);
  });

  it('M7: maps lastRate to currentPrice', () => {
    const records = mapOne(makeBalance({ lastRate: 9741, currencyCode: 'ILS' }));
    expect(records[0].currentPrice).toBe(97.41);
  });

  it('M8: securityName from hebName when available', () => {
    const records = mapOne(makeBalance({ hebName: 'בנק לאומי' }));
    expect(records[0].securityName).toBe('בנק לאומי');
  });

  it('M9: output record has correct shape with all required fields', () => {
    const records = mapOne(makeBalance());
    const r = records[0];

    expect(r.id).toBeDefined();
    expect(r.providerId).toBe(PROVIDER_ID);
    expect(r.providerIntegrationId).toBe(INTEGRATION_ID);
    expect(r.accountId).toBe(ACCOUNT_ID);
    expect(r.importRunId).toBe(RUN_ID);
    expect(r.securityId).toBeDefined();
    expect(r.securityName).toBeDefined();
    expect(r.actionType).toBeDefined();
    expect(r.quantity).toBeDefined();
    expect(r.costBasis).toBeDefined();
    expect(r.currency).toBeDefined();
    expect(r.actionDate).toBeDefined();
    expect(r.createdAt).toBeDefined();
    expect(r.updatedAt).toBeDefined();
  });

  // ── Edge Cases ──

  it('E1: null hebName fallback — uses existing CSV record securityName', () => {
    const existing: ProviderHoldingRecord[] = [{
      id: 'existing-1',
      providerId: PROVIDER_ID,
      providerIntegrationId: 'csv-integration',
      accountId: ACCOUNT_ID,
      securityId: '5130919',
      securityName: 'Leumi from CSV',
      actionType: 'קניה',
      quantity: 50,
      costBasis: 80,
      currency: 'ILS',
      actionDate: '2025-01-15',
      createdAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-01-15T00:00:00Z',
    }];
    const records = mapOne(makeBalance({ hebName: null }), existing);
    expect(records[0].securityName).toBe('Leumi from CSV');
  });

  it('E1b: null hebName fallback — uses securityId when no existing records', () => {
    const records = mapOne(makeBalance({ hebName: null, equityNumber: '5130919' }));
    expect(records[0].securityName).toBe('Security #5130919');
  });

  it('E2: zero quantity position skipped', () => {
    const handler = new PsagotApiImportHandler();
    const records = handler.mapBalancesToHoldingRecords({
      balances: [makeBalance({ quantity: 0 }), makeBalance({ equityNumber: '999', quantity: 50 })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_ID,
      importRunId: RUN_ID,
      existingRecords: [],
      agorotConversion: true,
    });
    expect(records).toHaveLength(1);
    expect(records[0].securityId).toBe('999');
  });

  it('E3: missing equityNumber treated as invalid (skipped)', () => {
    const records = mapOne(makeBalance({ equityNumber: '' }));
    expect(records).toHaveLength(0);
  });

  it('E4: missing averagePrice treated as invalid (skipped)', () => {
    const records = mapOne(makeBalance({ averagePrice: 0 }));
    expect(records).toHaveLength(0);
  });

  it('E5: negative quantity treated as invalid (skipped)', () => {
    const records = mapOne(makeBalance({ quantity: -5 }));
    expect(records).toHaveLength(0);
  });

  it('E6: multiple positions mapped to array of records', () => {
    const handler = new PsagotApiImportHandler();
    const records = handler.mapBalancesToHoldingRecords({
      balances: [
        makeBalance({ equityNumber: '111', quantity: 10 }),
        makeBalance({ equityNumber: '222', quantity: 20 }),
        makeBalance({ equityNumber: '333', quantity: 30 }),
      ],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_ID,
      importRunId: RUN_ID,
      existingRecords: [],
      agorotConversion: true,
    });
    expect(records).toHaveLength(3);
  });

  it('E7: actionType set to "hold" for API positions', () => {
    const records = mapOne(makeBalance());
    expect(records[0].actionType).toBe('hold');
  });

  it('E8: actionDate set to today (sync timestamp)', () => {
    const records = mapOne(makeBalance());
    const today = new Date().toISOString().slice(0, 10);
    expect(records[0].actionDate).toBe(today);
  });

  it('agorotConversion=false skips conversion even for ILS', () => {
    const handler = new PsagotApiImportHandler();
    const records = handler.mapBalancesToHoldingRecords({
      balances: [makeBalance({ averagePrice: 8500, lastRate: 9741, currencyCode: 'ILS' })],
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      accountId: ACCOUNT_ID,
      importRunId: RUN_ID,
      existingRecords: [],
      agorotConversion: false,
    });
    expect(records[0].costBasis).toBe(8500);
    expect(records[0].currentPrice).toBe(9741);
  });
});
