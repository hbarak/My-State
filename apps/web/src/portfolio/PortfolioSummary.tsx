import type { EnrichedHoldingsState } from '../../../../packages/domain/src/types/marketPrice';
import styles from './PortfolioSummary.module.css';

interface PortfolioSummaryProps {
  readonly enrichedState: EnrichedHoldingsState;
}

export function PortfolioSummary({ enrichedState }: PortfolioSummaryProps): JSX.Element {
  const { priceSummary, pricesFetchedAt, insufficientData } = enrichedState;

  const currencies = Object.keys(enrichedState.costTotalsByCurrency);

  return (
    <section className={styles.summary}>
      <div className={styles.summaryHeader}>
        <h2>Portfolio Overview</h2>
        <PriceBadge priceSummary={priceSummary} />
      </div>

      {insufficientData && (
        <p className={styles.warning}>
          Some positions lack price data — totals are partial.
        </p>
      )}

      {currencies.length === 0 && (
        <p className={styles.muted}>No positions to display.</p>
      )}

      <div className={styles.currencyTotals}>
        {currencies.map((currency) => {
          const cost = enrichedState.costTotalsByCurrency[currency] ?? 0;
          const value = enrichedState.valuationTotalsByCurrency[currency];
          const gain = enrichedState.unrealizedGainTotalsByCurrency[currency];
          const gainPct = gain !== undefined && cost > 0 ? (gain / cost) * 100 : undefined;

          return (
            <div key={currency} className={styles.currencyCard}>
              <h3>{currency}</h3>
              <div className={styles.grid}>
                <div className={styles.box} data-testid="summary-value">
                  <h3>Value</h3>
                  <p>{value !== undefined ? formatCurrency(value, currency) : '—'}</p>
                </div>
                <div className={styles.box} data-testid="summary-cost">
                  <h3>Cost</h3>
                  <p>{formatCurrency(cost, currency)}</p>
                </div>
                <div className={`${styles.box} ${gainBoxClass(gain)}`} data-testid="summary-gain-loss">
                  <h3>Gain / Loss</h3>
                  <p className={gainClass(gain)}>
                    {gain !== undefined ? `${gainArrow(gain)} ${formatSignedCurrency(gain, currency)}` : '—'}
                  </p>
                </div>
                <div className={`${styles.box} ${gainBoxClass(gain)}`} data-testid="summary-gain-pct">
                  <h3>Gain %</h3>
                  <p className={gainClass(gain)}>
                    {gainPct !== undefined ? `${gainArrow(gain)} ${formatPct(gainPct)}` : '—'}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pricesFetchedAt && (
        <p className={`${styles.muted} ${styles.priceTimestamp}`}>
          Prices fetched {formatRelativeTime(pricesFetchedAt)}
        </p>
      )}
    </section>
  );
}

function PriceBadge({ priceSummary }: { priceSummary: EnrichedHoldingsState['priceSummary'] }): JSX.Element {
  if (priceSummary.total === 0) return <></>;

  if (priceSummary.unavailable === 0) {
    return <span className={styles.badgeGreen}>All prices live</span>;
  }
  if (priceSummary.live > 0) {
    return <span className={styles.badgeYellow}>Partial prices</span>;
  }
  return <span className={styles.badgeRed}>Prices unavailable</span>;
}

function gainClass(gain: number | undefined): string {
  if (gain === undefined) return '';
  if (gain > 0) return styles.gainPositive;
  if (gain < 0) return styles.gainNegative;
  return '';
}

function gainBoxClass(gain: number | undefined): string {
  if (gain === undefined) return '';
  if (gain > 0) return styles.gainBox;
  if (gain < 0) return styles.lossBox;
  return '';
}

function gainArrow(gain: number | undefined): string {
  if (gain === undefined) return '';
  if (gain > 0) return '\u25B2';
  if (gain < 0) return '\u25BC';
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
