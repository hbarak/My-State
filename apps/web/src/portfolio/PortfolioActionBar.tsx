import { useState } from 'react';
import type { PriceSummary } from '../../../../packages/domain/src/types/marketPrice';
import type { Account } from '../../../../packages/domain/src/types/account';
import type { Provider } from '../../../../packages/domain/src/types/provider';
import { ApiSyncCard } from '../import/ApiSyncCard';
import { psagotSessionStore } from '../domain/bootstrap';
import styles from './PortfolioActionBar.module.css';

interface ProviderAccountGroup {
  readonly provider: Provider;
  readonly accounts: readonly Account[];
}

interface PortfolioActionBarProps {
  readonly pricesFetchedAt: string | undefined;
  readonly priceSummary: PriceSummary;
  readonly onRefresh: () => void;
  readonly onPortfolioChanged: () => void;
  readonly priceQuotaExceeded?: boolean;
  readonly autoRefreshEnabled?: boolean;
  readonly onAutoRefreshToggle?: (enabled: boolean) => void;
  readonly autoRefreshIntervalMs?: number;
  readonly onIntervalChange?: (intervalMs: number) => void;
  readonly autoRefreshActive?: boolean;
  readonly accountGroups?: readonly ProviderAccountGroup[];
  readonly selectedAccountId?: string;
  readonly onAccountFilterChange?: (accountId: string | undefined) => void;
}

const INTERVAL_OPTIONS = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '15m', ms: 900_000 },
];

export function PortfolioActionBar({
  pricesFetchedAt,
  priceSummary,
  onRefresh,
  onPortfolioChanged,
  priceQuotaExceeded = false,
  autoRefreshEnabled = false,
  onAutoRefreshToggle,
  autoRefreshIntervalMs = 300_000,
  onIntervalChange,
  autoRefreshActive = false,
  accountGroups = [],
  selectedAccountId,
  onAccountFilterChange,
}: PortfolioActionBarProps): JSX.Element {
  const [syncOpen, setSyncOpen] = useState(false);
  const [psagotPriceStatus, setPsagotPriceStatus] = useState<'idle' | 'no_session'>('idle');

  const handleSyncClose = (): void => {
    setSyncOpen(false);
  };

  const handleAccountsChanged = (): void => {
    onPortfolioChanged();
  };

  const handlePsagotPriceRefresh = (): void => {
    if (!psagotSessionStore.hasActiveSession()) {
      setPsagotPriceStatus('no_session');
      setTimeout(() => setPsagotPriceStatus('idle'), 3000);
      return;
    }
    setPsagotPriceStatus('idle');
    onRefresh();
  };

  const handleAccountChange = (value: string): void => {
    onAccountFilterChange?.(value === '' ? undefined : value);
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.bar}>
        {onAccountFilterChange && accountGroups.length > 0 && (
          <select
            className={styles.accountFilter}
            value={selectedAccountId ?? ''}
            onChange={(e) => handleAccountChange(e.target.value)}
            aria-label="Filter by account"
          >
            <option value="">All accounts</option>
            {accountGroups.map((group) => (
              <optgroup key={group.provider.id} label={group.provider.name}>
                {group.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

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
            className={styles.refreshButton}
            onClick={handlePsagotPriceRefresh}
            title={psagotSessionStore.hasActiveSession() ? 'Refresh prices via Psagot session' : 'No active Psagot session — sync first'}
            aria-label="Refresh prices from Psagot"
          >
            ↻ Psagot
          </button>
          {onAutoRefreshToggle && (
            <label className={styles.autoRefreshLabel}>
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={(e) => onAutoRefreshToggle(e.target.checked)}
                aria-label="Enable auto-refresh"
              />
              {autoRefreshActive ? 'Auto ✓' : 'Auto'}
            </label>
          )}
          {autoRefreshEnabled && onIntervalChange && (
            <select
              className={styles.intervalSelect}
              value={autoRefreshIntervalMs}
              onChange={(e) => onIntervalChange(Number(e.target.value))}
              aria-label="Auto-refresh interval"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>{opt.label}</option>
              ))}
            </select>
          )}
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

      {psagotPriceStatus === 'no_session' && (
        <p className={styles.quotaWarning} role="status">
          No active Psagot session — sync first to enable Psagot price refresh.
        </p>
      )}

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
