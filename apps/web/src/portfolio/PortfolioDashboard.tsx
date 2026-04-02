import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnrichedHoldings } from '../hooks/useEnrichedHoldings';
import { SPRINT1_PROVIDER_ID, domain } from '../domain/bootstrap';
import { PortfolioSummary } from './PortfolioSummary';
import { PositionTable } from './PositionTable';
import { PortfolioActionBar } from './PortfolioActionBar';
import type { TickerMappingStatus } from '../../../../packages/domain/src/types/marketPrice';
import styles from './PortfolioDashboard.module.css';

export function PortfolioDashboard(): JSX.Element {
  const { state, data, error, refetch } = useEnrichedHoldings(SPRINT1_PROVIDER_ID);
  const [expandedSecurityId, setExpandedSecurityId] = useState<string | null>(null);
  const [tickerMappings, setTickerMappings] = useState<ReadonlyMap<string, TickerMappingStatus>>(new Map());
  const fetchVersion = useRef(0);

  const loadTickerMappings = useCallback(async (): Promise<void> => {
    const version = ++fetchVersion.current;
    const statuses = await domain.tickerResolver.listMappingsWithStatus();
    if (version !== fetchVersion.current) return;
    const map = new Map<string, TickerMappingStatus>();
    for (const s of statuses) {
      map.set(s.securityId, s);
    }
    setTickerMappings(map);
  }, []);

  useEffect(() => {
    void loadTickerMappings();
  }, [loadTickerMappings]);

  const handleResetTicker = useCallback(async (securityId: string): Promise<void> => {
    await domain.tickerResolver.resetMapping(securityId);
    await loadTickerMappings();
    refetch();
  }, [loadTickerMappings, refetch]);

  const handleSelectPosition = (securityId: string): void => {
    setExpandedSecurityId((prev) => (prev === securityId ? null : securityId));
  };

  const handleCloseDrillDown = (): void => {
    setExpandedSecurityId(null);
  };

  if (state === 'loading' && !data) {
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
        <p className={styles.muted}>No holdings imported yet. Upload a CSV to get started.</p>
      </div>
    );
  }

  return (
    <div className={styles.dashboard}>
      <PortfolioActionBar
        pricesFetchedAt={data.pricesFetchedAt}
        priceSummary={data.priceSummary}
        onRefresh={refetch}
        onPortfolioChanged={refetch}
      />

      <PortfolioSummary enrichedState={data} />

      <PositionTable
        positions={data.positions}
        providerId={SPRINT1_PROVIDER_ID}
        expandedSecurityId={expandedSecurityId}
        onSelectPosition={handleSelectPosition}
        onCloseDrillDown={handleCloseDrillDown}
        tickerMappings={tickerMappings}
        onResetTicker={(securityId) => void handleResetTicker(securityId)}
        onPortfolioChanged={refetch}
      />
    </div>
  );
}
