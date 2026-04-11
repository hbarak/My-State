import type { Exchange } from './MarketHoursService';
import { MarketHoursService } from './MarketHoursService';

export interface PriceFreshnessResult {
  /** Age of the price in milliseconds. */
  readonly ageMs: number;
  /** True if fetchedAt >= lastMarketClose for this exchange. */
  readonly isFresh: boolean;
  /** True if the market is currently open. */
  readonly isMarketOpen: boolean;
  /** Human-readable age label: "just now", "5m ago", "3h ago", "2d ago". */
  readonly label: string;
}

const _service = new MarketHoursService();

/**
 * Classifies the freshness of a price for a given exchange.
 * @param fetchedAt ISO timestamp when the price was fetched.
 * @param exchange The exchange the security trades on.
 * @param now Optional current time (defaults to Date.now()).
 */
export function classifyFreshness(
  fetchedAt: string,
  exchange: Exchange,
  now: Date = new Date(),
): PriceFreshnessResult {
  const fetchedAtMs = new Date(fetchedAt).getTime();
  const ageMs = now.getTime() - fetchedAtMs;
  const isMarketOpen = _service.isMarketOpen(exchange, now);
  const lastClose = _service.lastMarketClose(exchange, now);
  const isFresh = fetchedAtMs >= lastClose.getTime();

  return {
    ageMs,
    isFresh,
    isMarketOpen,
    label: buildLabel(ageMs),
  };
}

function buildLabel(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
