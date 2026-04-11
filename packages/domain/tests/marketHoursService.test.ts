import { describe, expect, it } from 'vitest';
import { MarketHoursService } from '../src/services/MarketHoursService';
import type { Exchange } from '../src/services/MarketHoursService';

const service = new MarketHoursService();

// Helper: build a Date at a specific ISO string
function d(iso: string): Date {
  return new Date(iso);
}

describe('MarketHoursService.getExchangeForTicker', () => {
  it('returns TA for .TA suffix', () => {
    expect(service.getExchangeForTicker('DELEK.TA')).toBe('TA');
    expect(service.getExchangeForTicker('LEUMI.TA')).toBe('TA');
  });

  it('returns TA for all-digit TASE fund IDs', () => {
    expect(service.getExchangeForTicker('1084128')).toBe('TA');
    expect(service.getExchangeForTicker('5555551')).toBe('TA');
  });

  it('returns US for US ticker symbols', () => {
    expect(service.getExchangeForTicker('AAPL')).toBe('US');
    expect(service.getExchangeForTicker('MSFT')).toBe('US');
    expect(service.getExchangeForTicker('TSLA')).toBe('US');
  });

  it('returns null for unknown format', () => {
    expect(service.getExchangeForTicker('')).toBeNull();
  });
});

describe('MarketHoursService.isMarketOpen — TASE (TA)', () => {
  // TASE: Sun–Thu 09:45–17:25 Israel time (UTC+2 standard, UTC+3 DST)
  // Israel DST 2026: last Friday of March = March 27 → until last Sunday of October = Oct 25
  // So in Jan 2026: UTC+2. 09:45 IST = 07:45 UTC. 17:25 IST = 15:25 UTC.

  it('is open on Sunday during session hours (IST standard time)', () => {
    // 2026-01-11 is a Sunday. 10:00 IST = 08:00 UTC
    expect(service.isMarketOpen('TA', d('2026-01-11T08:00:00Z'))).toBe(true);
  });

  it('is open on Thursday during session hours', () => {
    // 2026-01-15 is Thursday. 14:00 IST = 12:00 UTC
    expect(service.isMarketOpen('TA', d('2026-01-15T12:00:00Z'))).toBe(true);
  });

  it('is closed on Friday', () => {
    // 2026-01-16 is Friday. 11:00 IST = 09:00 UTC
    expect(service.isMarketOpen('TA', d('2026-01-16T09:00:00Z'))).toBe(false);
  });

  it('is closed on Saturday', () => {
    // 2026-01-17 is Saturday
    expect(service.isMarketOpen('TA', d('2026-01-17T10:00:00Z'))).toBe(false);
  });

  it('is closed before market open on Sunday', () => {
    // 2026-01-11 Sunday. 07:00 IST = 05:00 UTC (before 09:45 IST)
    expect(service.isMarketOpen('TA', d('2026-01-11T05:00:00Z'))).toBe(false);
  });

  it('is closed after market close on Thursday', () => {
    // 2026-01-15 Thursday. 18:00 IST = 16:00 UTC (after 17:25)
    expect(service.isMarketOpen('TA', d('2026-01-15T16:00:00Z'))).toBe(false);
  });

  it('is open during DST (UTC+3): session hours shift', () => {
    // 2026-04-05 is Sunday, during IST DST (UTC+3). 10:00 IST = 07:00 UTC
    expect(service.isMarketOpen('TA', d('2026-04-05T07:00:00Z'))).toBe(true);
  });

  it('is closed after TASE close during DST', () => {
    // 2026-04-05 Sunday DST. 18:00 IST = 15:00 UTC (after 17:25 IST)
    expect(service.isMarketOpen('TA', d('2026-04-05T15:00:00Z'))).toBe(false);
  });
});

describe('MarketHoursService.isMarketOpen — NYSE (US)', () => {
  // NYSE: Mon–Fri 09:30–16:00 Eastern time (UTC-5 standard, UTC-4 DST)
  // US DST 2026: 2nd Sunday of March = March 8 → 1st Sunday of November = Nov 1
  // Jan 2026: UTC-5. 09:30 ET = 14:30 UTC. 16:00 ET = 21:00 UTC.

  it('is open on Monday during session hours (ET standard)', () => {
    // 2026-01-12 Monday. 11:00 ET = 16:00 UTC
    expect(service.isMarketOpen('US', d('2026-01-12T16:00:00Z'))).toBe(true);
  });

  it('is open on Friday during session hours', () => {
    // 2026-01-16 Friday. 15:00 ET = 20:00 UTC
    expect(service.isMarketOpen('US', d('2026-01-16T20:00:00Z'))).toBe(true);
  });

  it('is closed on Saturday', () => {
    expect(service.isMarketOpen('US', d('2026-01-17T16:00:00Z'))).toBe(false);
  });

  it('is closed on Sunday', () => {
    expect(service.isMarketOpen('US', d('2026-01-18T16:00:00Z'))).toBe(false);
  });

  it('is closed before market open on Monday', () => {
    // 2026-01-12 Monday. 08:00 ET = 13:00 UTC (before 09:30 ET)
    expect(service.isMarketOpen('US', d('2026-01-12T13:00:00Z'))).toBe(false);
  });

  it('is closed after market close on Friday', () => {
    // 2026-01-16 Friday. 17:00 ET = 22:00 UTC (after 16:00 ET)
    expect(service.isMarketOpen('US', d('2026-01-16T22:00:00Z'))).toBe(false);
  });

  it('is open during US DST (UTC-4)', () => {
    // 2026-04-06 Monday DST. 11:00 ET = 15:00 UTC
    expect(service.isMarketOpen('US', d('2026-04-06T15:00:00Z'))).toBe(true);
  });
});

describe('MarketHoursService.lastMarketClose', () => {
  it('TASE: returns previous Thursday close when called on Saturday', () => {
    // 2026-01-17 is Saturday (IST UTC+2). Last close was Thu Jan 15 17:25 IST = 15:25 UTC
    const result = service.lastMarketClose('TA', d('2026-01-17T10:00:00Z'));
    expect(result.toISOString()).toBe('2026-01-15T15:25:00.000Z');
  });

  it('TASE: returns same day close when called after close on Thursday', () => {
    // 2026-01-15 Thursday 18:00 IST = 16:00 UTC (after 17:25 IST = 15:25 UTC)
    const result = service.lastMarketClose('TA', d('2026-01-15T16:00:00Z'));
    expect(result.toISOString()).toBe('2026-01-15T15:25:00.000Z');
  });

  it('TASE: returns previous day close when called before open on Sunday', () => {
    // 2026-01-18 is Sunday 07:00 IST = 05:00 UTC (before open 07:45 UTC)
    // Previous trading day close was Thu Jan 15
    const result = service.lastMarketClose('TA', d('2026-01-18T05:00:00Z'));
    expect(result.toISOString()).toBe('2026-01-15T15:25:00.000Z');
  });

  it('NYSE: returns previous Friday close when called on weekend', () => {
    // 2026-01-17 Saturday. Last NYSE close was Fri Jan 16 16:00 ET = 21:00 UTC
    const result = service.lastMarketClose('US', d('2026-01-17T10:00:00Z'));
    expect(result.toISOString()).toBe('2026-01-16T21:00:00.000Z');
  });

  it('NYSE: returns same day close when called after close on Friday', () => {
    // 2026-01-16 Friday 17:00 ET = 22:00 UTC (after 16:00 ET = 21:00 UTC)
    const result = service.lastMarketClose('US', d('2026-01-16T22:00:00Z'));
    expect(result.toISOString()).toBe('2026-01-16T21:00:00.000Z');
  });
});
