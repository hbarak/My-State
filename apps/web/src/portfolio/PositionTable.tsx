import { useMemo } from 'react';
import type { EnrichedHoldingsPosition, PriceSource, TickerMappingStatus } from '../../../../packages/domain/src/types/marketPrice';
import { SecurityDrillDown } from './SecurityDrillDown';
import { formatQty, convertUsdToIls } from './formatters';
import styles from './PositionTable.module.css';
import tickerStyles from './TickerStatus.module.css';

interface PositionTableProps {
  readonly positions: readonly EnrichedHoldingsPosition[];
  readonly expandedSecurityId: string | null;
  readonly onSelectPosition: (securityId: string) => void;
  readonly onCloseDrillDown: () => void;
  readonly tickerMappings?: ReadonlyMap<string, TickerMappingStatus>;
  readonly onResetTicker?: (securityId: string) => void;
  readonly onPortfolioChanged?: () => void;
  readonly exchangeRate?: number | null;
}

export function PositionTable({
  positions,
  expandedSecurityId,
  onSelectPosition,
  onCloseDrillDown,
  tickerMappings,
  onResetTicker,
  onPortfolioChanged,
  exchangeRate,
}: PositionTableProps): JSX.Element {
  const sorted = useMemo(
    () =>
      [...positions].sort((a, b) => {
        const aVal = a.currentValue ?? -1;
        const bVal = b.currentValue ?? -1;
        return bVal - aVal;
      }),
    [positions],
  );

  return (
    <div className={styles.wrapper}>
      <h3>Positions</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th className={styles.hideNarrow}>Qty</th>
            <th className={`${styles.num} ${styles.hideNarrow}`}>Avg Cost</th>
            <th className={`${styles.num} ${styles.hideNarrow}`}>Price</th>
            <th className={styles.num}>Value</th>
            <th className={styles.num}>Gain %</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((pos) => {
            const isExpanded = pos.securityId === expandedSecurityId;
            return (
              <PositionRow
                key={pos.key}
                position={pos}
                providerId={pos.providerId}
                isExpanded={isExpanded}
                onSelect={() => onSelectPosition(pos.securityId)}
                onClose={onCloseDrillDown}
                tickerStatus={tickerMappings?.get(pos.securityId)}
                onResetTicker={onResetTicker}
                onPortfolioChanged={onPortfolioChanged}
                exchangeRate={exchangeRate ?? null}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PositionRow({
  position,
  providerId,
  isExpanded,
  onSelect,
  onClose,
  tickerStatus,
  onResetTicker,
  onPortfolioChanged,
  exchangeRate,
}: {
  readonly position: EnrichedHoldingsPosition;
  readonly providerId: string;
  readonly isExpanded: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
  readonly tickerStatus?: TickerMappingStatus;
  readonly onResetTicker?: (securityId: string) => void;
  readonly onPortfolioChanged?: () => void;
  readonly exchangeRate: number | null;
}): JSX.Element {
  const isUsd = position.currency === 'USD';
  const ilsValue = isUsd && position.currentValue !== undefined
    ? convertUsdToIls(position.currentValue, exchangeRate)
    : null;

  return (
    <>
      <tr
        className={rowClassName(position.priceSource, isExpanded)}
        onClick={onSelect}
        title={priceTooltip(position.priceSource)}
      >
        <td>
          <div className={styles.nameCell}>
            <span className={styles.securityName}>
              {position.securityName ?? position.securityId}
            </span>
            <TickerCell
              securityId={position.securityId}
              ticker={position.ticker}
              tickerStatus={tickerStatus}
            />
          </div>
        </td>
        <td className={styles.hideNarrow}>{formatQty(position.quantity)}</td>
        <td className={`${styles.num} ${styles.hideNarrow}`}>{formatMoney(position.costBasis, position.currency)}</td>
        <td className={`${styles.num} ${styles.hideNarrow}`}>{position.currentPrice !== undefined ? formatMoney(position.currentPrice, position.currency) : '—'}</td>
        <td className={styles.num}>
          <ValueCell
            position={position}
            isUsd={isUsd}
            ilsValue={ilsValue}
            rateAvailable={exchangeRate !== null}
          />
        </td>
        <td className={styles.num}>
          <GainPill gain={position.unrealizedGain} gainPct={position.unrealizedGainPct} />
        </td>
      </tr>
      {isExpanded && (
        <SecurityDrillDown
          position={position}
          providerId={providerId}
          onClose={onClose}
          onPortfolioChanged={onPortfolioChanged}
          onResetTicker={onResetTicker}
          tickerStatus={tickerStatus}
        />
      )}
    </>
  );
}

/** Shows ticker as muted subtext. Only displays a warning icon when resolution has failed. */
function TickerCell({
  ticker,
  tickerStatus,
}: {
  readonly securityId: string;
  readonly ticker?: string;
  readonly tickerStatus?: TickerMappingStatus;
}): JSX.Element {
  const failed = tickerStatus?.status === 'failed';

  if (failed) {
    return (
      <span className={tickerStyles.tickerSubtext} aria-label="Ticker resolution failed">
        <span className={tickerStyles.tickerWarningIcon} aria-hidden="true">⚠</span>
        {' —'}
      </span>
    );
  }

  return (
    <span className={tickerStyles.tickerSubtext}>
      {ticker ?? '—'}
    </span>
  );
}

function ValueCell({
  position,
  isUsd,
  ilsValue,
  rateAvailable,
}: {
  readonly position: EnrichedHoldingsPosition;
  readonly isUsd: boolean;
  readonly ilsValue: number | null;
  readonly rateAvailable: boolean;
}): JSX.Element {
  if (position.currentValue === undefined) return <span>—</span>;

  // Non-USD: display as-is
  if (!isUsd) return <span>{formatMoney(position.currentValue, position.currency)}</span>;

  // USD with rate available: show ILS primary, USD muted below
  if (ilsValue !== null) {
    return (
      <div className={styles.valueCell}>
        <span>{formatMoney(ilsValue, 'ILS')}</span>
        <span className={styles.valueCellSub}>{formatMoney(position.currentValue, 'USD')}</span>
      </div>
    );
  }

  // USD without rate: show USD with ~ prefix
  return (
    <span aria-label="Approximate value — ILS conversion unavailable">
      ~{formatMoney(position.currentValue, 'USD')}
    </span>
  );
}

function GainPill({ gain, gainPct }: { readonly gain?: number; readonly gainPct?: number }): JSX.Element {
  if (gainPct === undefined) return <span>—</span>;
  const isPositive = (gain ?? 0) >= 0;
  const pillClass = isPositive ? styles.gainPill : styles.lossPill;
  return (
    <span className={pillClass}>
      {gainArrow(gain)} {formatPct(gainPct)}
    </span>
  );
}

const PRICE_SOURCE_STYLES: Record<PriceSource, string | undefined> = {
  live: undefined,
  stale: styles.sourceStale,
  csv: styles.sourceCsv,
  unavailable: styles.sourceUnavailable,
};

function rowClassName(priceSource: PriceSource, isExpanded: boolean): string {
  const classes = [styles.positionRow];
  const sourceStyle = PRICE_SOURCE_STYLES[priceSource];
  if (sourceStyle) classes.push(sourceStyle);
  if (isExpanded) classes.push(styles.expanded);
  return classes.join(' ');
}

function priceTooltip(priceSource: PriceSource): string {
  switch (priceSource) {
    case 'live': return '';
    case 'stale': return 'Price from earlier this session';
    case 'csv': return 'Using broker-reported price';
    case 'unavailable': return 'No price available';
  }
}

function gainArrow(gain: number | undefined): string {
  if (gain === undefined) return '';
  if (gain > 0) return '\u25B2';
  if (gain < 0) return '\u25BC';
  return '';
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
  const formatted = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currencySymbol(currency) + formatted;
}

function formatPct(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + (value * 100).toFixed(2) + '%';
}
