import { describe, expect, it } from 'vitest';
import { runCsvPatternFitCheck } from '../src/services/PatternFitCheck';
import type { ProviderMappingProfile } from '../src/types';

function makeProfile(): ProviderMappingProfile {
  const now = new Date().toISOString();
  return {
    id: 'profile-1',
    providerId: 'provider-1',
    providerIntegrationId: 'integration-1',
    name: 'Profile',
    version: 1,
    isActive: true,
    inputFormat: 'csv',
    fieldMappings: {
      accountId: 'Account',
      symbol: 'Symbol',
      side: 'Side',
      quantity: 'Qty',
      price: 'Price',
      tradeAt: 'TradeDate',
      externalTradeId: 'ExternalId',
    },
    requiredCanonicalFields: ['accountId', 'symbol', 'side', 'quantity', 'price', 'tradeAt'],
    optionalCanonicalFields: ['externalTradeId'],
    createdAt: now,
    updatedAt: now,
  };
}

describe('runCsvPatternFitCheck', () => {
  it('fails when a required header is missing', () => {
    const profile = makeProfile();
    const csv = 'Account,Symbol,Side,Qty,Price\n1,AAPL,BUY,1,100';

    const result = runCsvPatternFitCheck(profile, csv);
    expect(result.decision).toBe('fail');
    expect(result.fitScore).toBe(0);
    expect(result.reasons[0]).toContain('Missing required headers');
  });

  it('returns pass on exact/strong mapped header coverage', () => {
    const profile = makeProfile();
    const csv = 'Account,Symbol,Side,Qty,Price,TradeDate,ExternalId\n1,AAPL,BUY,1,100,2026-02-01,abc';

    const result = runCsvPatternFitCheck(profile, csv);
    expect(result.decision).toBe('pass');
    expect(result.fitScore).toBe(100);
  });

  it('returns warn when required headers exist but mapped coverage is below threshold', () => {
    const profile = makeProfile();
    const csv = 'Account,Symbol,Side,Qty,Price,TradeDate\n1,AAPL,BUY,1,100,2026-02-01';

    const result = runCsvPatternFitCheck(profile, csv);
    expect(result.decision).toBe('warn');
    expect(result.fitScore).toBeLessThan(90);
  });

  it('fails when expected Hebrew encoding is configured and input looks mojibake', () => {
    const profile = makeProfile();
    profile.parsingRules = { expectedEncoding: 'WINDOWS-1255' };
    const csv = '���� ��"�,�� ����,����,����,����,���� ����� �������\n1,AAPL,BUY,1,100,02/09/2025';

    const result = runCsvPatternFitCheck(profile, csv);
    expect(result.decision).toBe('fail');
    expect(result.reasons[0]).toContain('mis-decoded');
  });

  it('passes Hebrew text when expected encoding is configured and input is readable', () => {
    const profile = makeProfile();
    profile.parsingRules = { expectedEncoding: 'WINDOWS-1255' };
    profile.fieldMappings = {
      accountId: 'מספר חשבון',
      symbol: 'סימול',
      side: 'סוג פעולה',
      quantity: 'כמות',
      price: 'מחיר',
      tradeAt: 'תאריך',
    };
    const csv = 'מספר חשבון,סימול,סוג פעולה,כמות,מחיר,תאריך\n1,AAPL,BUY,1,100,02/09/2025';

    const result = runCsvPatternFitCheck(profile, csv);
    expect(result.decision).toBe('pass');
  });
});
