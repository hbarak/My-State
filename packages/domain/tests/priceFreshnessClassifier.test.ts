import { describe, expect, it } from 'vitest';
import { classifyFreshness } from '../src/services/PriceFreshnessClassifier';

function d(iso: string): Date {
  return new Date(iso);
}

describe('classifyFreshness — TASE (TA)', () => {
  // TASE closes Thu 17:25 IST (UTC+2 in Jan 2026) = 15:25 UTC
  // 2026-01-15 is Thursday

  it('price fetched after last close is fresh (same day after close)', () => {
    const fetchedAt = '2026-01-15T15:30:00Z'; // 30 min after close
    const now = d('2026-01-15T16:00:00Z');     // same day, still Thursday after close
    const result = classifyFreshness(fetchedAt, 'TA', now);
    expect(result.isFresh).toBe(true);
  });

  it('price fetched before last close is stale', () => {
    const fetchedAt = '2026-01-14T15:00:00Z'; // Wednesday afternoon
    const now = d('2026-01-15T16:00:00Z');     // Thursday after close
    const result = classifyFreshness(fetchedAt, 'TA', now);
    expect(result.isFresh).toBe(false);
  });

  it('price from Thursday is still fresh on Saturday (market was closed)', () => {
    const fetchedAt = '2026-01-15T15:30:00Z'; // after Thursday close
    const now = d('2026-01-17T10:00:00Z');     // Saturday
    const result = classifyFreshness(fetchedAt, 'TA', now);
    expect(result.isFresh).toBe(true);
    expect(result.isMarketOpen).toBe(false);
  });

  it('isMarketOpen is true when called during TASE session', () => {
    // 2026-01-11 Sunday 10:00 IST = 08:00 UTC
    const fetchedAt = '2026-01-11T07:50:00Z';
    const now = d('2026-01-11T08:00:00Z');
    const result = classifyFreshness(fetchedAt, 'TA', now);
    expect(result.isMarketOpen).toBe(true);
  });

  it('isMarketOpen is false on Friday', () => {
    const fetchedAt = '2026-01-15T15:30:00Z';
    const now = d('2026-01-16T09:00:00Z'); // Friday
    const result = classifyFreshness(fetchedAt, 'TA', now);
    expect(result.isMarketOpen).toBe(false);
  });
});

describe('classifyFreshness — NYSE (US)', () => {
  // NYSE closes Fri 16:00 ET (UTC-5 in Jan 2026) = 21:00 UTC
  // 2026-01-16 is Friday

  it('price fetched after last close is fresh', () => {
    const fetchedAt = '2026-01-16T21:30:00Z'; // 30 min after Friday close
    const now = d('2026-01-16T22:00:00Z');
    const result = classifyFreshness(fetchedAt, 'US', now);
    expect(result.isFresh).toBe(true);
  });

  it('price from Friday is fresh on Saturday', () => {
    const fetchedAt = '2026-01-16T21:30:00Z';
    const now = d('2026-01-17T12:00:00Z'); // Saturday
    const result = classifyFreshness(fetchedAt, 'US', now);
    expect(result.isFresh).toBe(true);
    expect(result.isMarketOpen).toBe(false);
  });

  it('price fetched before Friday close is stale on Saturday', () => {
    const fetchedAt = '2026-01-15T20:00:00Z'; // Thursday evening UTC
    const now = d('2026-01-17T12:00:00Z');     // Saturday
    const result = classifyFreshness(fetchedAt, 'US', now);
    expect(result.isFresh).toBe(false);
  });
});

describe('classifyFreshness — ageMs and label', () => {
  it('ageMs is approximately correct', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    const result = classifyFreshness(twoHoursAgo, 'US');
    expect(result.ageMs).toBeGreaterThan(1.9 * 3600_000);
    expect(result.ageMs).toBeLessThan(2.1 * 3600_000);
  });

  it('label: "just now" for < 60s', () => {
    const fetchedAt = new Date(Date.now() - 30_000).toISOString();
    const result = classifyFreshness(fetchedAt, 'US');
    expect(result.label).toBe('just now');
  });

  it('label: "Xm ago" for < 60 min', () => {
    const fetchedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const result = classifyFreshness(fetchedAt, 'US');
    expect(result.label).toBe('5m ago');
  });

  it('label: "Xh ago" for < 24h', () => {
    const fetchedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    const result = classifyFreshness(fetchedAt, 'US');
    expect(result.label).toBe('3h ago');
  });

  it('label: "Xd ago" for >= 24h', () => {
    const fetchedAt = new Date(Date.now() - 2 * 86400_000).toISOString();
    const result = classifyFreshness(fetchedAt, 'US');
    expect(result.label).toBe('2d ago');
  });
});
