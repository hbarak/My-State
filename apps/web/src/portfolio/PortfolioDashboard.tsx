import { useState } from 'react';
import { useEnrichedHoldings } from '../hooks/useEnrichedHoldings';
import { SPRINT1_PROVIDER_ID } from '../domain/bootstrap';
import { PortfolioSummary } from './PortfolioSummary';
import { AllocationChart } from './AllocationChart';
import { PositionTable } from './PositionTable';

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
      <div className="dashboard-loading">
        <p>Loading portfolio...</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="card dashboard-error">
        <h2>Failed to load portfolio</h2>
        <p className="error">{error}</p>
        <button onClick={refetch}>Retry</button>
      </div>
    );
  }

  if (!data || data.positionCount === 0) {
    return (
      <div className="card dashboard-empty">
        <h2>Portfolio</h2>
        <p className="muted">No holdings imported yet. Upload a CSV to get started.</p>
      </div>
    );
  }

  const currencies = Object.keys(data.costTotalsByCurrency);

  return (
    <div className="portfolio-dashboard">
      <div className="dashboard-header">
        <h2>Portfolio</h2>
        <button className="secondary" onClick={refetch}>Refresh</button>
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
