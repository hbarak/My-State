import type { EnrichedHoldingsState } from '../../../../packages/domain/src/types/marketPrice';
import { HeroNetWorth } from './HeroNetWorth';
import styles from './PortfolioSummary.module.css';

interface PortfolioSummaryProps {
  readonly enrichedState: EnrichedHoldingsState;
}

export function PortfolioSummary({ enrichedState }: PortfolioSummaryProps): JSX.Element {
  const { priceSummary } = enrichedState;
  const currencies = Object.keys(enrichedState.costTotalsByCurrency);
  const secondaryCurrencies = currencies.filter((c) => c !== primaryCurrency(currencies));

  return (
    <section className={styles.summary}>
      <div className={styles.summaryHeader}>
        <HeroNetWorth enrichedState={enrichedState} />
        <PriceBadge priceSummary={priceSummary} />
      </div>

      {secondaryCurrencies.length > 0 && (
        <div className={styles.secondaryRow}>
          {secondaryCurrencies.map((currency) => (
            <SecondaryCurrencyPill key={currency} currency={currency} enrichedState={enrichedState} />
          ))}
        </div>
      )}
    </section>
  );
}

function SecondaryCurrencyPill({
  currency,
  enrichedState,
}: {
  readonly currency: string;
  readonly enrichedState: EnrichedHoldingsState;
}): JSX.Element {
  const value = enrichedState.valuationTotalsByCurrency[currency];
  const gain = enrichedState.unrealizedGainTotalsByCurrency[currency];

  return (
    <div className={styles.secondaryPill}>
      <span className={styles.currencyLabel}>{currency}</span>
      <span className={styles.currencyValue} data-testid={`summary-value-${currency}`}>
        {value !== undefined ? formatCurrency(value, currency) : '—'}
      </span>
      {gain !== undefined && (
        <span className={`${styles.currencyGain} ${gain >= 0 ? styles.gainPositive : styles.gainNegative}`}>
          {gain >= 0 ? '▲' : '▼'} {formatSignedCurrency(gain, currency)}
        </span>
      )}
    </div>
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

function primaryCurrency(currencies: readonly string[]): string | undefined {
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
