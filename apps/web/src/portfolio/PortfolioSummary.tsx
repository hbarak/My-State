import type { EnrichedHoldingsState } from '../../../../packages/domain/src/types/marketPrice';
import { convertUsdToIls } from './formatters';
import { HeroNetWorth } from './HeroNetWorth';
import styles from './PortfolioSummary.module.css';

interface PortfolioSummaryProps {
  readonly enrichedState: EnrichedHoldingsState;
  readonly exchangeRate: number | null;
}

export function PortfolioSummary({ enrichedState, exchangeRate }: PortfolioSummaryProps): JSX.Element {
  const { priceSummary } = enrichedState;
  const currencies = Object.keys(enrichedState.costTotalsByCurrency);
  // Show secondary currencies (non-ILS) as breakdown pills
  const secondaryCurrencies = currencies.filter((c) => c !== 'ILS');

  return (
    <section className={styles.summary}>
      <div className={styles.summaryHeader}>
        <HeroNetWorth enrichedState={enrichedState} exchangeRate={exchangeRate} />
        <PriceBadge priceSummary={priceSummary} />
      </div>

      {secondaryCurrencies.length > 0 && (
        <div className={styles.secondaryRow}>
          {secondaryCurrencies.map((currency) => (
            <SecondaryCurrencyPill
              key={currency}
              currency={currency}
              enrichedState={enrichedState}
              exchangeRate={exchangeRate}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SecondaryCurrencyPill({
  currency,
  enrichedState,
  exchangeRate,
}: {
  readonly currency: string;
  readonly enrichedState: EnrichedHoldingsState;
  readonly exchangeRate: number | null;
}): JSX.Element {
  const value = enrichedState.valuationTotalsByCurrency[currency];
  const gain = enrichedState.unrealizedGainTotalsByCurrency[currency];

  const isUsd = currency === 'USD';
  const ilsEquivalent = isUsd && value !== undefined
    ? convertUsdToIls(value, exchangeRate)
    : null;

  return (
    <div className={styles.secondaryPill}>
      <span className={styles.currencyLabel}>{currency}</span>
      <span className={styles.currencyValue} data-testid={`summary-value-${currency}`}>
        {ilsEquivalent !== null ? (
          <>
            <span>{formatCurrency(ilsEquivalent, 'ILS')}</span>
            <span className={styles.currencySubValue}>~{formatCurrency(value!, currency)}</span>
          </>
        ) : value !== undefined ? (
          isUsd && exchangeRate === null ? (
            <>
              <span>{formatCurrency(value, currency)}</span>
              <span className={styles.currencySubValue}>(no rate)</span>
            </>
          ) : (
            formatCurrency(value, currency)
          )
        ) : (
          '—'
        )}
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
