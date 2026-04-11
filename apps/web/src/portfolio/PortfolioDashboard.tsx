import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnrichedHoldings } from '../hooks/useEnrichedHoldings';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { SPRINT1_PROVIDER_ID, domain } from '../domain/bootstrap';
import { PortfolioSummary } from './PortfolioSummary';
import { PositionTable } from './PositionTable';
import { PortfolioActionBar } from './PortfolioActionBar';
import type { TickerMappingStatus } from '../../../../packages/domain/src/types/marketPrice';
import styles from './PortfolioDashboard.module.css';

const AUTO_REFRESH_CONFIG_KEY = 'my-stocks:web:auto-refresh-config';

function loadAutoRefreshConfig(): { enabled: boolean; intervalMs: number } {
  try {
    const raw = localStorage.getItem(AUTO_REFRESH_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>).enabled === 'boolean' &&
        typeof (parsed as Record<string, unknown>).intervalMs === 'number'
      ) {
        return parsed as { enabled: boolean; intervalMs: number };
      }
    }
  } catch {
    // ignore
  }
  return { enabled: false, intervalMs: 300_000 };
}

async function fetchExchangeRate(): Promise<number | null> {
  try {
    const response = await fetch('/api/boi-rate');
    if (!response.ok) return null;
    const body = await response.json() as unknown;
    if (
      typeof body === 'object' &&
      body !== null &&
      typeof (body as Record<string, unknown>).rate === 'number'
    ) {
      return (body as Record<string, unknown>).rate as number;
    }
    return null;
  } catch {
    return null;
  }
}

export function PortfolioDashboard(): JSX.Element {
  const { state, data, error, priceQuotaExceeded, refetch } = useEnrichedHoldings(SPRINT1_PROVIDER_ID);
  const [expandedSecurityId, setExpandedSecurityId] = useState<string | null>(null);
  const [tickerMappings, setTickerMappings] = useState<ReadonlyMap<string, TickerMappingStatus>>(new Map());
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const fetchVersion = useRef(0);

  const [autoRefreshConfig, setAutoRefreshConfig] = useState(loadAutoRefreshConfig);
  const { isActive: autoRefreshActive } = useAutoRefresh({
    enabled: autoRefreshConfig.enabled,
    intervalMs: autoRefreshConfig.intervalMs,
    quotaExhausted: priceQuotaExceeded,
    onRefresh: refetch,
  });

  const handleAutoRefreshToggle = (enabled: boolean): void => {
    const next = { ...autoRefreshConfig, enabled };
    setAutoRefreshConfig(next);
    localStorage.setItem(AUTO_REFRESH_CONFIG_KEY, JSON.stringify(next));
  };

  const handleIntervalChange = (intervalMs: number): void => {
    const next = { ...autoRefreshConfig, intervalMs };
    setAutoRefreshConfig(next);
    localStorage.setItem(AUTO_REFRESH_CONFIG_KEY, JSON.stringify(next));
  };

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

  // Fetch שער יציג once on mount — session-scoped, not persisted
  useEffect(() => {
    fetchExchangeRate().then(setExchangeRate).catch(() => setExchangeRate(null));
  }, []);

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
        priceQuotaExceeded={priceQuotaExceeded}
        autoRefreshEnabled={autoRefreshConfig.enabled}
        onAutoRefreshToggle={handleAutoRefreshToggle}
        autoRefreshIntervalMs={autoRefreshConfig.intervalMs}
        onIntervalChange={handleIntervalChange}
        autoRefreshActive={autoRefreshActive}
      />

      <PortfolioSummary enrichedState={data} exchangeRate={exchangeRate} />

      <PositionTable
        positions={data.positions}
        providerId={SPRINT1_PROVIDER_ID}
        expandedSecurityId={expandedSecurityId}
        onSelectPosition={handleSelectPosition}
        onCloseDrillDown={handleCloseDrillDown}
        tickerMappings={tickerMappings}
        onResetTicker={(securityId) => void handleResetTicker(securityId)}
        onPortfolioChanged={refetch}
        exchangeRate={exchangeRate}
      />
    </div>
  );
}
