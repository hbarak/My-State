import { describe, it, expect } from 'vitest';
import { extractNav, extractLastRate } from '../src/plugins/price-plugin';

describe('extractNav', () => {
  it('returns UnitValuePrice when positive number', () => {
    expect(extractNav({ UnitValuePrice: 425.11 })).toBe(425.11);
  });

  it('returns null when UnitValuePrice is zero', () => {
    expect(extractNav({ UnitValuePrice: 0 })).toBeNull();
  });

  it('returns null when UnitValuePrice is negative', () => {
    expect(extractNav({ UnitValuePrice: -1 })).toBeNull();
  });

  it('returns null when UnitValuePrice is a string', () => {
    expect(extractNav({ UnitValuePrice: '425.11' })).toBeNull();
  });

  it('returns null when UnitValuePrice is missing', () => {
    expect(extractNav({ AssetValue: 2369.8 })).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractNav(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(extractNav('string')).toBeNull();
    expect(extractNav(42)).toBeNull();
  });
});

describe('extractLastRate', () => {
  it('returns LastRate when positive number', () => {
    expect(extractLastRate({ LastRate: 1234.5 })).toBe(1234.5);
  });

  it('returns null when LastRate is zero', () => {
    expect(extractLastRate({ LastRate: 0 })).toBeNull();
  });

  it('returns null when LastRate is negative', () => {
    expect(extractLastRate({ LastRate: -5 })).toBeNull();
  });

  it('returns null when LastRate is a string', () => {
    expect(extractLastRate({ LastRate: '1234.5' })).toBeNull();
  });

  it('returns null when LastRate is missing', () => {
    expect(extractLastRate({ SomeOtherField: 100 })).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractLastRate(null)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(extractLastRate('string')).toBeNull();
    expect(extractLastRate(42)).toBeNull();
  });
});
