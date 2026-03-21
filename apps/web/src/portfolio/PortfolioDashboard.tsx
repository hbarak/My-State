import { useState } from 'react';
import { useEnrichedHoldings } from '../hooks/useEnrichedHoldings';
import { SPRINT1_PROVIDER_ID } from '../domain/bootstrap';
import { PortfolioSummary } from './PortfolioSummary';
import { AllocationChart } from './AllocationChart';
import { PositionTable } from './PositionTable';
import styles from './PortfolioDashboard.module.css';

export function PortfolioDashboard(): JSX.Element {
  const { state, data, error, refetch } = useEnrichedHoldings(SPRINT1_PROVIDER_ID);
  const [expandedSecurityId, setExpandedSecurityId] = useState<string | null>(null);

  const handleSelectPosition = (securityId: string): void => {
    setExpandedSecurityId((prev) => (prev === securityId ? null : securityId));
  };

  const handleCloseDrillDown = (): void => {
    setExpandedSecurityId(null);
  };

  if (state === 'loading') {
    return (
      <div className={styles.loading}>
        <p>Loading portfolio...</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className={`${styles.card} ${styles.error}`}>
        <h2>Failed to load portfolio</h2>
        <p className={styles.errorText}>{error}</p>
        <button className={styles.retryButton} onClick={refetch}>Retry</button>
      </div>
    );
  }

  if (!data || data.positionCount === 0) {
    return (
      <div className={`${styles.card} ${styles.empty}`}>
        <h2>Portfolio</h2>
        <p className={styles.muted}>No holdings imported yet. Upload a CSV to get started.</p>
      </div>
    );
  }

  const currencies = Object.keys(data.costTotalsByCurrency);

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <h2>Portfolio</h2>
        <button className={styles.refreshButton} onClick={refetch}>Refresh</button>
      </div>

      <PortfolioSummary enrichedState={data} />

      {currencies.map((currency) => (
        <AllocationChart
          key={currency}
          positions={data.positions}
          currency={currency}
        />
      ))}

      <PositionTable
        positions={data.positions}
        providerId={SPRINT1_PROVIDER_ID}
        expandedSecurityId={expandedSecurityId}
        onSelectPosition={handleSelectPosition}
        onCloseDrillDown={handleCloseDrillDown}
      />
    </div>
  );
}
