import { useMemo } from 'react';
import type { EnrichedHoldingsPosition, PriceSource } from '../../../../packages/domain/src/types/marketPrice';
import { SecurityDrillDown } from './SecurityDrillDown';

interface PositionTableProps {
  readonly positions: readonly EnrichedHoldingsPosition[];
  readonly providerId: string;
  readonly expandedSecurityId: string | null;
  readonly onSelectPosition: (securityId: string) => void;
  readonly onCloseDrillDown: () => void;
}

export function PositionTable({
  positions,
  providerId,
  expandedSecurityId,
  onSelectPosition,
  onCloseDrillDown,
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
    <div className="position-table-wrapper">
      <h3>Positions</h3>
      <table className="position-table">
        <thead>
          <tr>
            <th>Security</th>
            <th>Ticker</th>
            <th className="num">Qty</th>
            <th className="num">Avg Cost</th>
            <th className="num">Price</th>
            <th className="num">Value</th>
            <th className="num">Gain/Loss</th>
            <th className="num">Gain %</th>
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
}: {
  readonly position: EnrichedHoldingsPosition;
  readonly providerId: string;
  readonly isExpanded: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <>
      <tr
        className={rowClassName(position.priceSource, isExpanded)}
        onClick={onSelect}
        title={priceTooltip(position.priceSource)}
      >
        <td>{position.securityName}</td>
        <td>{position.ticker ?? '—'}</td>
        <td className="num">{formatNum(position.quantity)}</td>
        <td className="num">{formatMoney(position.costBasis, position.currency)}</td>
        <td className="num">{position.currentPrice !== undefined ? formatMoney(position.currentPrice, position.currency) : '—'}</td>
        <td className="num">{position.currentValue !== undefined ? formatMoney(position.currentValue, position.currency) : '—'}</td>
        <td className={`num ${gainClass(position.unrealizedGain)}`}>
          {position.unrealizedGain !== undefined ? formatSignedMoney(position.unrealizedGain, position.currency) : '—'}
        </td>
        <td className={`num ${gainClass(position.unrealizedGain)}`}>
          {position.unrealizedGainPct !== undefined ? formatPct(position.unrealizedGainPct) : '—'}
        </td>
      </tr>
      {isExpanded && (
        <SecurityDrillDown position={position} providerId={providerId} onClose={onClose} />
      )}
    </>
  );
}

function rowClassName(priceSource: PriceSource, isExpanded: boolean): string {
  const classes = ['position-row', `price-source--${priceSource}`];
  if (isExpanded) classes.push('position-row--expanded');
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

function gainClass(gain: number | undefined): string {
  if (gain === undefined) return '';
  if (gain > 0) return 'gain-positive';
  if (gain < 0) return 'gain-negative';
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

function formatSignedMoney(value: number, currency: string): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + formatMoney(value, currency);
}

function formatPct(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + (value * 100).toFixed(2) + '%';
}
