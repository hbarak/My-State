import type { PriceSummary } from '../../../../packages/domain/src/types/marketPrice';
import styles from './PriceFreshnessBar.module.css';

interface PriceFreshnessBarProps {
  readonly pricesFetchedAt: string | undefined;
  readonly priceSummary: PriceSummary;
  readonly onRefresh: () => void;
}

export function PriceFreshnessBar({ pricesFetchedAt, priceSummary, onRefresh }: PriceFreshnessBarProps): JSX.Element {
  return (
    <div className={styles.bar}>
      <span className={styles.timestamp}>
        {pricesFetchedAt
          ? `Prices as of ${formatRelativeTime(pricesFetchedAt)}`
          : 'Prices not yet loaded'}
      </span>
      {priceSummary.unavailable > 0 && priceSummary.live === 0 && (
        <span className={styles.statusBadge} data-status="unavailable">
          No live prices
        </span>
      )}
      {priceSummary.unavailable > 0 && priceSummary.live > 0 && (
        <span className={styles.statusBadge} data-status="partial">
          Partial prices
        </span>
      )}
      <button
        type="button"
        className={styles.refreshButton}
        onClick={onRefresh}
        aria-label="Refresh prices"
      >
        ↻ Refresh
      </button>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
