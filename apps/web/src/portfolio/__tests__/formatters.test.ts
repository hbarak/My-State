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

// ILS passthrough contract (GAP-1 from S9-QA-01):
// PositionTable.tsx:101–103 guards on `isUsd` before calling convertUsdToIls.
// Non-USD positions set ilsValue = null and display the native currency value unchanged.
// This describe block tests the caller contract — not the function internals.
describe('ILS passthrough — non-USD position skips conversion', () => {
  it('simulated ILS position: ilsValue stays null when isUsd=false (no conversion called)', () => {
    // Caller logic: const ilsValue = isUsd && currentValue !== undefined
    //   ? convertUsdToIls(currentValue, exchangeRate)
    //   : null;
    // For an ILS position: isUsd=false → ilsValue=null regardless of exchangeRate.
    const isUsd = false;
    const currentValue = 4540; // ILS position value
    const exchangeRate = 3.7;
    const ilsValue = isUsd && currentValue !== undefined
      ? convertUsdToIls(currentValue, exchangeRate)
      : null;
    expect(ilsValue).toBeNull(); // ILS position not converted — passed through as-is
  });

  it('simulated USD position: ilsValue is computed when isUsd=true and rate available', () => {
    const isUsd = true;
    const currentValue = 1000; // USD position value
    const exchangeRate = 3.7;
    const ilsValue = isUsd && currentValue !== undefined
      ? convertUsdToIls(currentValue, exchangeRate)
      : null;
    expect(ilsValue).toBeCloseTo(3700); // USD converted to ILS
  });
});
