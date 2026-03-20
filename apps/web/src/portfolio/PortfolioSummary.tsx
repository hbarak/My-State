import type { EnrichedHoldingsState } from '../../../../packages/domain/src/types/marketPrice';

interface PortfolioSummaryProps {
  readonly enrichedState: EnrichedHoldingsState;
}

export function PortfolioSummary({ enrichedState }: PortfolioSummaryProps): JSX.Element {
  const { priceSummary, pricesFetchedAt, insufficientData } = enrichedState;

  const currencies = Object.keys(enrichedState.costTotalsByCurrency);

  return (
    <section className="card portfolio-summary">
      <div className="summary-header">
        <h2>Portfolio Overview</h2>
        <PriceBadge priceSummary={priceSummary} />
      </div>

      {insufficientData && (
        <p className="warning">
          Some positions lack price data — totals are partial.
        </p>
      )}

      {currencies.length === 0 && (
        <p className="muted">No positions to display.</p>
      )}

      <div className="currency-totals">
        {currencies.map((currency) => {
          const cost = enrichedState.costTotalsByCurrency[currency] ?? 0;
          const value = enrichedState.valuationTotalsByCurrency[currency];
          const gain = enrichedState.unrealizedGainTotalsByCurrency[currency];
          const gainPct = gain !== undefined && cost > 0 ? (gain / cost) * 100 : undefined;

          return (
            <div key={currency} className="currency-total-card card">
              <h3>{currency}</h3>
              <div className="summary-grid summary-grid--2col">
                <div className="summary-box">
                  <h3>Value</h3>
                  <p>{value !== undefined ? formatCurrency(value, currency) : '—'}</p>
                </div>
                <div className="summary-box">
                  <h3>Cost</h3>
                  <p>{formatCurrency(cost, currency)}</p>
                </div>
                <div className="summary-box">
                  <h3>Gain / Loss</h3>
                  <p className={gainClass(gain)}>
                    {gain !== undefined ? formatSignedCurrency(gain, currency) : '—'}
                  </p>
                </div>
                <div className="summary-box">
                  <h3>Gain %</h3>
                  <p className={gainClass(gain)}>
                    {gainPct !== undefined ? formatPct(gainPct) : '—'}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pricesFetchedAt && (
        <p className="muted price-timestamp">
          Prices fetched {formatRelativeTime(pricesFetchedAt)}
        </p>
      )}
    </section>
  );
}

function PriceBadge({ priceSummary }: { priceSummary: EnrichedHoldingsState['priceSummary'] }): JSX.Element {
  if (priceSummary.total === 0) return <></>;

  if (priceSummary.unavailable === 0) {
    return <span className="badge badge--green">All prices live</span>;
  }
  if (priceSummary.live > 0) {
    return <span className="badge badge--yellow">Partial prices</span>;
  }
  return <span className="badge badge--red">Prices unavailable</span>;
}

function gainClass(gain: number | undefined): string {
  if (gain === undefined) return '';
  if (gain > 0) return 'gain-positive';
  if (gain < 0) return 'gain-negative';
  return '';
}

function formatCurrency(value: number, currency: string): string {
  try {
    return value.toLocaleString(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function formatSignedCurrency(value: number, currency: string): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + formatCurrency(value, currency);
}

function formatPct(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + value.toFixed(2) + '%';
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
