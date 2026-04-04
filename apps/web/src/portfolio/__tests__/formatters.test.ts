import { describe, expect, it } from 'vitest';
import { formatQty, convertUsdToIls } from '../formatters';

describe('formatQty', () => {
  it('formats a whole number without decimal point', () => {
    expect(formatQty(100)).toBe('100');
  });

  it('formats a decimal quantity preserving significant fractional digits', () => {
    expect(formatQty(10.5)).toBe('10.5');
  });

  it('formats zero as "0"', () => {
    expect(formatQty(0)).toBe('0');
  });

  it('strips trailing zeros from whole-number float', () => {
    expect(formatQty(100.0)).toBe('100');
  });

  it('strips trailing zeros from fractional float', () => {
    expect(formatQty(10.50)).toBe('10.5');
  });

  it('handles fractional quantities with multiple significant digits', () => {
    expect(formatQty(1.234)).toBe('1.234');
  });
});

describe('convertUsdToIls', () => {
  it('multiplies amount by rate for a known positive rate', () => {
    expect(convertUsdToIls(100, 3.7)).toBeCloseTo(370);
  });

  it('returns null when rate is null (unavailable)', () => {
    expect(convertUsdToIls(500, null)).toBeNull();
  });

  it('returns null when rate is zero (avoids division/multiplication artefacts)', () => {
    expect(convertUsdToIls(500, 0)).toBeNull();
  });

  it('passes through zero amount correctly', () => {
    expect(convertUsdToIls(0, 3.7)).toBeCloseTo(0);
  });

  it('handles fractional USD amounts', () => {
    expect(convertUsdToIls(1.5, 3.7)).toBeCloseTo(5.55);
  });
});
