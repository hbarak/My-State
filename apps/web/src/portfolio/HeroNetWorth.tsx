import type { EnrichedHoldingsState } from '../../../../packages/domain/src/types/marketPrice';
import styles from './HeroNetWorth.module.css';

interface HeroNetWorthProps {
  readonly enrichedState: EnrichedHoldingsState;
}

export function HeroNetWorth({ enrichedState }: HeroNetWorthProps): JSX.Element {
  const primaryCurrency = pickPrimaryCurrency(enrichedState);

  if (!primaryCurrency) {
    return (
      <div className={styles.hero}>
        <p className={styles.empty}>No positions to display.</p>
      </div>
    );
  }

  const value = enrichedState.valuationTotalsByCurrency[primaryCurrency];
  const cost = enrichedState.costTotalsByCurrency[primaryCurrency] ?? 0;
  const gain = enrichedState.unrealizedGainTotalsByCurrency[primaryCurrency];
  const gainPct = gain !== undefined && cost > 0 ? (gain / cost) * 100 : undefined;
  const hasMarketValue = value !== undefined;

  return (
    <div className={styles.hero}>
      <p className={styles.label}>{hasMarketValue ? 'Net Worth' : 'Cost Basis'}</p>
      <p className={styles.amount} data-testid="hero-net-worth">
        {hasMarketValue ? formatCurrency(value, primaryCurrency) : formatCurrency(cost, primaryCurrency)}
      </p>
      {gain !== undefined && gainPct !== undefined && (
        <p className={`${styles.delta} ${gain >= 0 ? styles.positive : styles.negative}`}>
          <span aria-hidden="true">{gain >= 0 ? '▲' : '▼'}</span>{' '}
          {formatSignedCurrency(gain, primaryCurrency)} ({formatSignedPct(gainPct)})
        </p>
      )}
      {!hasMarketValue && (
        <p className={styles.partial}>Market prices unavailable — showing cost basis</p>
      )}
    </div>
  );
}

function pickPrimaryCurrency(state: EnrichedHoldingsState): string | undefined {
  const currencies = Object.keys(state.costTotalsByCurrency);
  if (currencies.length === 0) return undefined;
  // Prefer ILS (Israeli portfolio), then USD, then first available
  if (currencies.includes('ILS')) return 'ILS';
  if (currencies.includes('USD')) return 'USD';
  return currencies[0];
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

function formatSignedPct(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}
