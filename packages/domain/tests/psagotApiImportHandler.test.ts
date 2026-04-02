import { describe, expect, it } from 'vitest';
import { PsagotApiImportHandler } from '../src/services/PsagotApiImportHandler';
import type { PsagotBalance, PsagotSecurityInfo, ProviderHoldingRecord } from '../src/types';

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
    hebName: null,
    ...overrides,
  };
}

function makeSecurityInfo(overrides: Partial<PsagotSecurityInfo> = {}): PsagotSecurityInfo {
  return {
    equityNumber: '5130919',
    hebName: 'בנק לאומי',
    engName: 'Bank Leumi',
    engSymbol: null,
    exchange: 'TASE',
    currencyCode: 'ILS',
    currencyDivider: 100,
    isForeign: false,
    itemType: 'Stock',
    ...overrides,
  };
}

function mapOne(
  balance: PsagotBalance,
  securityInfoMap: Map<string, PsagotSecurityInfo> = new Map(),
  existingRecords: ProviderHoldingRecord[] = [],
): ProviderHoldingRecord[] {
  const handler = new PsagotApiImportHandler();
  return handler.mapBalancesToHoldingRecords({
    balances: [balance],
    providerId: PROVIDER_ID,
    providerIntegrationId: INTEGRATION_ID,
    accountId: ACCOUNT_ID,
    importRunId: RUN_ID,
    existingRecords,
    securityInfoMap,
  });
}

function infoMap(...infos: PsagotSecurityInfo[]): Map<string, PsagotSecurityInfo> {
  return new Map(infos.map((i) => [i.equityNumber, i]));
}

describe('PsagotApiImportHandler', () => {
  // ── Field Mapping ──

  it('M1: maps equityNumber to securityId', () => {
    const records = mapOne(makeBalance({ equityNumber: '5130919' }), infoMap(makeSecurityInfo()));
    expect(records[0].securityId).toBe('5130919');
  });

  it('M2: maps quantity (OnlineNV) to quantity', () => {
    const records = mapOne(makeBalance({ quantity: 250 }), infoMap(makeSecurityInfo()));
    expect(records[0].quantity).toBe(250);
  });

  it('M3: ILS with currencyDivider=100 divides averagePrice by 100 (agorot)', () => {
    const records = mapOne(
      makeBalance({ averagePrice: 8500, currencyCode: 'ILS' }),
      infoMap(makeSecurityInfo({ currencyDivider: 100 })),
    );
    expect(records[0].costBasis).toBe(85); // 8500 agorot = 85 ILS
  });

  it('M4: maps currencyCode to currency', () => {
    const records = mapOne(makeBalance({ currencyCode: 'ILS' }), infoMap(makeSecurityInfo()));
    expect(records[0].currency).toBe('ILS');
  });

  it('M5: USD security with currencyDivider=1 — no conversion', () => {
    const records = mapOne(
      makeBalance({ currencyCode: 'USD', averagePrice: 150, lastRate: 160 }),
      infoMap(makeSecurityInfo({ currencyDivider: 1, currencyCode: 'USD', isForeign: true })),
    );
    expect(records[0].costBasis).toBe(150);
    expect(records[0].currentPrice).toBe(160);
  });

  it('M6: ILS agorot — costBasis and currentPrice both divided', () => {
    const records = mapOne(
      makeBalance({ averagePrice: 4550, lastRate: 4700, currencyCode: 'ILS' }),
      infoMap(makeSecurityInfo({ currencyDivider: 100 })),
    );
    expect(records[0].costBasis).toBe(45.5);
    expect(records[0].currentPrice).toBe(47);
  });

  it('M7: maps lastRate to currentPrice', () => {
    const records = mapOne(
      makeBalance({ lastRate: 9741, currencyCode: 'ILS' }),
      infoMap(makeSecurityInfo({ currencyDivider: 100 })),
    );
    expect(records[0].currentPrice).toBe(97.41);
  });

  it('M8: securityName from hebName in security info', () => {
    const records = mapOne(makeBalance(), infoMap(makeSecurityInfo({ hebName: 'בנק לאומי' })));
    expect(records[0].securityName).toBe('בנק לאומי');
  });

  it('M8b: falls back to engName when hebName is null', () => {
    const records = mapOne(makeBalance(), infoMap(makeSecurityInfo({ hebName: null, engName: 'Bank Leumi' })));
    expect(records[0].securityName).toBe('Bank Leumi');
  });

  it('M9: output record has correct shape with all required fields', () => {
    const records = mapOne(makeBalance(), infoMap(makeSecurityInfo()));
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

  it('E1: no security info, CSV record exists — uses CSV securityName', () => {
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
    const records = mapOne(makeBalance(), new Map(), existing);
    expect(records[0].securityName).toBe('Leumi from CSV');
  });

  it('E1b: no security info, no CSV record — falls back to Security #<id>', () => {
    const records = mapOne(makeBalance({ equityNumber: '5130919' }), new Map(), []);
    expect(records[0].securityName).toBe('Security #5130919');
  });

  it('E1c: no security info, no divider — defaults to divisor 1 (no conversion)', () => {
    const records = mapOne(makeBalance({ averagePrice: 8500, lastRate: 9741 }), new Map());
    expect(records[0].costBasis).toBe(8500);
    expect(records[0].currentPrice).toBe(9741);
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
      securityInfoMap: new Map(),
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

  it('E6: multiple positions mapped correctly', () => {
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
      securityInfoMap: new Map(),
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
});
