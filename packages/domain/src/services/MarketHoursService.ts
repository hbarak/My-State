export type Exchange = 'TA' | 'US';

// TASE: Sun–Thu 09:45–17:25 Israel Standard Time
// Israel DST: last Friday of March → last Sunday of October
const TASE_OPEN_HOUR = 9;
const TASE_OPEN_MINUTE = 45;
const TASE_CLOSE_HOUR = 17;
const TASE_CLOSE_MINUTE = 25;
// Trading days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu
const TASE_TRADING_DAYS = new Set([0, 1, 2, 3, 4]);

// NYSE: Mon–Fri 09:30–16:00 Eastern Time
// US DST: 2nd Sunday of March → 1st Sunday of November
const NYSE_OPEN_HOUR = 9;
const NYSE_OPEN_MINUTE = 30;
const NYSE_CLOSE_HOUR = 16;
const NYSE_CLOSE_MINUTE = 0;
// Trading days: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri
const NYSE_TRADING_DAYS = new Set([1, 2, 3, 4, 5]);

export class MarketHoursService {
  getExchangeForTicker(ticker: string): Exchange | null {
    if (!ticker) return null;
    if (ticker.endsWith('.TA')) return 'TA';
    if (/^\d+$/.test(ticker)) return 'TA';
    if (/^[A-Z]+$/.test(ticker)) return 'US';
    return null;
  }

  isMarketOpen(exchange: Exchange, now: Date = new Date()): boolean {
    const offsetMinutes = getUtcOffsetMinutes(exchange, now);
    const local = toLocal(now, offsetMinutes);
    const day = local.dayOfWeek;

    if (exchange === 'TA') {
      if (!TASE_TRADING_DAYS.has(day)) return false;
      return isInSession(local, TASE_OPEN_HOUR, TASE_OPEN_MINUTE, TASE_CLOSE_HOUR, TASE_CLOSE_MINUTE);
    }

    // US
    if (!NYSE_TRADING_DAYS.has(day)) return false;
    return isInSession(local, NYSE_OPEN_HOUR, NYSE_OPEN_MINUTE, NYSE_CLOSE_HOUR, NYSE_CLOSE_MINUTE);
  }

  /**
   * Returns the most recent market close for the given exchange as a UTC Date.
   * If the market is currently open, returns the close time from the last completed session.
   * If the market is closed, returns the close time of the most recently completed session.
   */
  lastMarketClose(exchange: Exchange, now: Date = new Date()): Date {
    const offsetMinutes = getUtcOffsetMinutes(exchange, now);
    const local = toLocal(now, offsetMinutes);

    const [closeHour, closeMinute] =
      exchange === 'TA'
        ? [TASE_CLOSE_HOUR, TASE_CLOSE_MINUTE]
        : [NYSE_CLOSE_HOUR, NYSE_CLOSE_MINUTE];

    const tradingDays = exchange === 'TA' ? TASE_TRADING_DAYS : NYSE_TRADING_DAYS;

    // Walk backward from today to find the last trading day with a past close time
    for (let daysBack = 0; daysBack <= 7; daysBack++) {
      const candidateLocal = subtractDays(local, daysBack);
      if (!tradingDays.has(candidateLocal.dayOfWeek)) continue;

      // Is the close time in the past relative to `now`?
      const closeUtcMs = localToUtcMs(candidateLocal, closeHour, closeMinute, -offsetMinutes);
      if (closeUtcMs <= now.getTime()) {
        return new Date(closeUtcMs);
      }
    }

    // Should not reach here for valid inputs
    throw new Error(`Could not compute lastMarketClose for exchange ${exchange}`);
  }
}

// --- Internal helpers ---

interface LocalDateTime {
  year: number;
  month: number; // 1-based
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number; // 0=Sun
}

function toLocal(utc: Date, offsetMinutes: number): LocalDateTime {
  const shiftedMs = utc.getTime() + offsetMinutes * 60_000;
  const shifted = new Date(shiftedMs);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

function subtractDays(local: LocalDateTime, days: number): LocalDateTime {
  // Reconstruct as UTC midnight at local date, subtract days
  const ms = Date.UTC(local.year, local.month - 1, local.day - days);
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: local.hour,
    minute: local.minute,
    dayOfWeek: d.getUTCDay(),
  };
}

function localToUtcMs(local: LocalDateTime, hour: number, minute: number, negOffsetMinutes: number): number {
  // Convert a local date + time back to UTC
  const utcMs = Date.UTC(local.year, local.month - 1, local.day, hour, minute, 0, 0);
  return utcMs + negOffsetMinutes * 60_000;
}

function isInSession(
  local: LocalDateTime,
  openHour: number,
  openMinute: number,
  closeHour: number,
  closeMinute: number,
): boolean {
  const nowMinutes = local.hour * 60 + local.minute;
  const openMinutes = openHour * 60 + openMinute;
  const closeMinutes = closeHour * 60 + closeMinute;
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

/**
 * Returns the UTC offset in minutes for the given exchange at the given time.
 * Positive = ahead of UTC (e.g. Israel UTC+2 → +120).
 */
function getUtcOffsetMinutes(exchange: Exchange, now: Date): number {
  if (exchange === 'TA') return israelUtcOffset(now);
  return usEasternUtcOffset(now);
}

/**
 * Israel Standard Time: UTC+2. DST: UTC+3.
 * DST start: last Friday of March at 02:00 local (midnight UTC that day).
 * DST end: last Sunday of October at 02:00 local.
 */
function israelUtcOffset(now: Date): number {
  const year = now.getUTCFullYear();
  const dstStart = lastWeekdayOfMonth(year, 3, 5); // last Friday of March (month=3 is April? no, 0-based=March)
  const dstEnd = lastWeekdayOfMonth(year, 9, 0);   // last Sunday of October

  // DST starts at 02:00 IST (= 00:00 UTC) on last Friday of March
  // DST ends at 02:00 IDT (= 23:00 UTC previous day) on last Sunday of October
  // Simplified: compare UTC timestamps of the transition midnight
  const dstStartUtc = Date.UTC(year, 2, dstStart, 0, 0, 0); // March (month index 2)
  const dstEndUtc = Date.UTC(year, 9, dstEnd, 0, 0, 0);     // October (month index 9)

  const nowMs = now.getTime();
  if (nowMs >= dstStartUtc && nowMs < dstEndUtc) {
    return 180; // UTC+3 during DST
  }
  return 120; // UTC+2 standard
}

/**
 * US Eastern Time: UTC-5 standard, UTC-4 DST.
 * DST start: 2nd Sunday of March at 02:00 local.
 * DST end: 1st Sunday of November at 02:00 local.
 */
function usEasternUtcOffset(now: Date): number {
  const year = now.getUTCFullYear();
  const dstStart = nthWeekdayOfMonth(year, 2, 0, 2); // 2nd Sunday of March
  const dstEnd = nthWeekdayOfMonth(year, 10, 0, 1);  // 1st Sunday of November

  // DST starts at 02:00 ET = 07:00 UTC on 2nd Sunday of March
  const dstStartUtc = Date.UTC(year, 2, dstStart, 7, 0, 0);
  // DST ends at 02:00 EDT = 06:00 UTC on 1st Sunday of November
  const dstEndUtc = Date.UTC(year, 10, dstEnd, 6, 0, 0);

  const nowMs = now.getTime();
  if (nowMs >= dstStartUtc && nowMs < dstEndUtc) {
    return -240; // UTC-4 during DST
  }
  return -300; // UTC-5 standard
}

/**
 * Returns the day-of-month for the nth occurrence of a weekday in a month.
 * @param month 0-based month index (0=Jan, 2=Mar, 10=Nov)
 * @param weekday 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
 * @param n 1-based occurrence (1=first, 2=second)
 */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCMonth() !== month) break;
    if (d.getUTCDay() === weekday) {
      count++;
      if (count === n) return day;
    }
  }
  throw new Error(`Could not find nth weekday: year=${year} month=${month} weekday=${weekday} n=${n}`);
}

/**
 * Returns the day-of-month for the last occurrence of a weekday in a month.
 * @param month 0-based month index
 * @param weekday 0=Sun, 5=Fri, etc.
 */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  let lastDay = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCMonth() !== month) break;
    if (d.getUTCDay() === weekday) lastDay = day;
  }
  if (lastDay === 0) throw new Error(`Could not find last weekday: year=${year} month=${month} weekday=${weekday}`);
  return lastDay;
}
