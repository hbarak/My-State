import type { EnrichedHoldingsState } from '../../../../packages/domain/src/types/marketPrice';
import { convertUsdToIls } from './formatters';
import styles from './HeroNetWorth.module.css';

interface HeroNetWorthProps {
  readonly enrichedState: EnrichedHoldingsState;
  readonly exchangeRate: number | null;
}

export function HeroNetWorth({ enrichedState, exchangeRate }: HeroNetWorthProps): JSX.Element {
  if (Object.keys(enrichedState.costTotalsByCurrency).length === 0) {
    return (
      <div className={styles.hero}>
        <p className={styles.empty}>No positions to display.</p>
      </div>
    );
  }

  const ilsValue = enrichedState.valuationTotalsByCurrency['ILS'];
  const usdValue = enrichedState.valuationTotalsByCurrency['USD'];
  const ilsCost = enrichedState.costTotalsByCurrency['ILS'] ?? 0;
  const usdCost = enrichedState.costTotalsByCurrency['USD'] ?? 0;

  const usdInIls = usdValue !== undefined ? convertUsdToIls(usdValue, exchangeRate) : null;
  const usdCostInIls = convertUsdToIls(usdCost, exchangeRate);

  const totalIlsValue = ilsValue !== undefined || usdInIls !== null
    ? (ilsValue ?? 0) + (usdInIls ?? 0)
    : undefined;
  const totalIlsCost = ilsCost + (usdCostInIls ?? usdCost);

  const hasMarketValue = totalIlsValue !== undefined;
  const ilsGain = hasMarketValue ? totalIlsValue - totalIlsCost : undefined;
  const gainPct = ilsGain !== undefined && totalIlsCost > 0 ? (ilsGain / totalIlsCost) * 100 : undefined;

  const rateUnavailable = usdValue !== undefined && exchangeRate === null;
  const label = hasMarketValue
    ? rateUnavailable ? 'Net Worth (est.)' : 'Net Worth (ILS)'
    : rateUnavailable ? 'Cost Basis (est.)' : 'Cost Basis (ILS)';

  const displayValue = hasMarketValue ? totalIlsValue : totalIlsCost;

  return (
    <div className={styles.hero}>
      <p className={styles.label}>
        {label}
        {rateUnavailable && (
          <span
            className={styles.rateUnavailableIcon}
            title="ILS conversion unavailable. Prices shown in original currency."
            aria-label="ILS conversion unavailable. Prices shown in original currency."
          >
            {' ℹ'}
          </span>
        )}
      </p>
      <p className={styles.amount} data-testid="hero-net-worth">
        {formatCurrency(displayValue, 'ILS')}
      </p>
      {ilsGain !== undefined && gainPct !== undefined && (
        <p className={`${styles.delta} ${ilsGain >= 0 ? styles.positive : styles.negative}`}>
          <span aria-hidden="true">{ilsGain >= 0 ? '▲' : '▼'}</span>{' '}
          {formatSignedCurrency(ilsGain, 'ILS')} ({formatSignedPct(gainPct)})
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
