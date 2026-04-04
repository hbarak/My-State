import { useState } from 'react';
import type { PriceSummary } from '../../../../packages/domain/src/types/marketPrice';
import { ApiSyncCard } from '../import/ApiSyncCard';
import styles from './PortfolioActionBar.module.css';

interface PortfolioActionBarProps {
  readonly pricesFetchedAt: string | undefined;
  readonly priceSummary: PriceSummary;
  readonly onRefresh: () => void;
  readonly onPortfolioChanged: () => void;
  readonly priceQuotaExceeded?: boolean;
}

export function PortfolioActionBar({
  pricesFetchedAt,
  priceSummary,
  onRefresh,
  onPortfolioChanged,
  priceQuotaExceeded = false,
}: PortfolioActionBarProps): JSX.Element {
  const [syncOpen, setSyncOpen] = useState(false);

  const handleSyncClose = (): void => {
    setSyncOpen(false);
  };

  const handleAccountsChanged = (): void => {
    onPortfolioChanged();
  };

  return (
    <div className={styles.wrapper}>
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

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={onRefresh}
            aria-label="Refresh prices"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            className={`${styles.syncButton} ${syncOpen ? styles.syncButtonActive : ''}`}
            onClick={() => setSyncOpen((prev) => !prev)}
            aria-expanded={syncOpen}
            aria-label="Sync portfolio from Psagot API"
          >
            ⟳ Sync
          </button>
        </div>
      </div>

      {priceQuotaExceeded && (
        <p className={styles.quotaWarning} role="status">
          Daily price limit reached. Prices will refresh tomorrow.
        </p>
      )}

      {syncOpen && (
        <div className={styles.syncPanel}>
          <ApiSyncCard
            disabled={false}
            onAccountsChanged={handleAccountsChanged}
            onClose={handleSyncClose}
          />
        </div>
      )}
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
