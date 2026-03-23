import type { AccountSubtotal } from '../../../../packages/domain/src/services/SecurityLotQueryService';
import type { SecurityLot } from '../../../../packages/domain/src/services/SecurityLotQueryService';
import styles from './AccountSection.module.css';

interface AccountSectionProps {
  readonly subtotal: AccountSubtotal;
  readonly currency: string;
  readonly livePrice: number | undefined;
  readonly renderLotTable: (lots: readonly SecurityLot[], livePrice: number | undefined, currency: string) => JSX.Element;
  readonly defaultOpen?: boolean;
}

export function AccountSection({
  subtotal,
  currency,
  livePrice,
  renderLotTable,
  defaultOpen = false,
}: AccountSectionProps): JSX.Element {
  return (
    <details className={styles.section} open={defaultOpen || undefined} data-testid="account-section">
      <summary className={styles.summary}>
        <span className={styles.accountName}>{subtotal.accountName}</span>
        <span className={styles.subtotals}>
          <span>{subtotal.lotCount} lot{subtotal.lotCount !== 1 ? 's' : ''}</span>
          <span>Qty: {formatNum(subtotal.quantity)}</span>
          <span>Avg: {formatMoney(subtotal.weightedAvgCostBasis, currency)}</span>
        </span>
      </summary>
      {renderLotTable(subtotal.lots, livePrice, currency)}
    </details>
  );
}

function formatNum(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '\u20AA',
  USD: '$',
  EUR: '\u20AC',
  GBP: '\u00A3',
};

function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency + ' ';
}

function formatMoney(value: number, currency: string): string {
  return currencySymbol(currency) + formatNum(value);
}
