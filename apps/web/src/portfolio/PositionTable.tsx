import { useMemo } from 'react';
import type { EnrichedHoldingsPosition, PriceSource, TickerMappingStatus } from '../../../../packages/domain/src/types/marketPrice';
import { SecurityDrillDown } from './SecurityDrillDown';
import styles from './PositionTable.module.css';
import tickerStyles from './TickerStatus.module.css';

interface PositionTableProps {
  readonly positions: readonly EnrichedHoldingsPosition[];
  readonly providerId: string;
  readonly expandedSecurityId: string | null;
  readonly onSelectPosition: (securityId: string) => void;
  readonly onCloseDrillDown: () => void;
  readonly tickerMappings?: ReadonlyMap<string, TickerMappingStatus>;
  readonly onResetTicker?: (securityId: string) => void;
  readonly onPortfolioChanged?: () => void;
}

export function PositionTable({
  positions,
  providerId,
  expandedSecurityId,
  onSelectPosition,
  onCloseDrillDown,
  tickerMappings,
  onResetTicker,
  onPortfolioChanged,
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
                providerId={providerId}
                isExpanded={isExpanded}
                onSelect={() => onSelectPosition(pos.securityId)}
                onClose={onCloseDrillDown}
                tickerStatus={tickerMappings?.get(pos.securityId)}
                onResetTicker={onResetTicker}
                onPortfolioChanged={onPortfolioChanged}
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
}: {
  readonly position: EnrichedHoldingsPosition;
  readonly providerId: string;
  readonly isExpanded: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
  readonly tickerStatus?: TickerMappingStatus;
  readonly onResetTicker?: (securityId: string) => void;
  readonly onPortfolioChanged?: () => void;
}): JSX.Element {
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
              onResetTicker={onResetTicker}
            />
          </div>
        </td>
        <td className={styles.hideNarrow}>{formatNum(position.quantity)}</td>
        <td className={`${styles.num} ${styles.hideNarrow}`}>{formatMoney(position.costBasis, position.currency)}</td>
        <td className={`${styles.num} ${styles.hideNarrow}`}>{position.currentPrice !== undefined ? formatMoney(position.currentPrice, position.currency) : '—'}</td>
        <td className={styles.num}>{position.currentValue !== undefined ? formatMoney(position.currentValue, position.currency) : '—'}</td>
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
        />
      )}
    </>
  );
}

function TickerCell({
  securityId,
  ticker,
  tickerStatus,
  onResetTicker,
}: {
  readonly securityId: string;
  readonly ticker?: string;
  readonly tickerStatus?: TickerMappingStatus;
  readonly onResetTicker?: (securityId: string) => void;
}): JSX.Element {
  if (!tickerStatus) {
    return <span>{ticker ?? '—'}</span>;
  }

  const { status } = tickerStatus;
  const badgeClass =
    status === 'manual' ? tickerStyles.badgeManual
    : status === 'failed' ? tickerStyles.badgeFailed
    : tickerStyles.badgeAuto;

  const badgeLabel = status === 'manual' ? 'M' : status === 'failed' ? '!' : 'A';
  const badgeTitle =
    status === 'manual' ? 'Manually set ticker'
    : status === 'failed' ? 'Ticker not resolved — click to retry'
    : 'Auto-resolved ticker';

  return (
    <span className={tickerStyles.tickerCell}>
      <span>{ticker ?? '—'}</span>
      <button
        type="button"
        className={`${tickerStyles.badge} ${badgeClass}`}
        title={badgeTitle}
        aria-label={`${badgeTitle}. Click to reset mapping for ${securityId}`}
        onClick={(e) => {
          e.stopPropagation();
          onResetTicker?.(securityId);
        }}
      >
        {badgeLabel}
      </button>
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

function formatPct(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + (value * 100).toFixed(2) + '%';
}
