import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnrichedHoldingsPosition } from '../../../../packages/domain/src/types/marketPrice';
import type { SecurityPosition, SecurityLot } from '../../../../packages/domain/src/services/SecurityLotQueryService';
import { domain } from '../domain/bootstrap';

interface SecurityDrillDownProps {
  readonly position: EnrichedHoldingsPosition;
  readonly providerId: string;
  readonly onClose: () => void;
}

type LotFetchState = 'loading' | 'ready' | 'error';

export function SecurityDrillDown({ position, providerId, onClose }: SecurityDrillDownProps): JSX.Element {
  const [fetchState, setFetchState] = useState<LotFetchState>('loading');
  const [securityPosition, setSecurityPosition] = useState<SecurityPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadLots = useCallback(() => {
    const reqId = ++requestRef.current;
    setFetchState('loading');
    setError(null);

    domain.securityLotQueryService
      .getSecurityLots({
        providerId,
        securityId: position.securityId,
      })
      .then((result) => {
        if (reqId !== requestRef.current) return;
        setSecurityPosition(result);
        setFetchState('ready');
      })
      .catch((err: unknown) => {
        if (reqId !== requestRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load lots');
        setFetchState('error');
      });
  }, [position.securityId, providerId]);

  useEffect(() => {
    loadLots();
  }, [loadLots]);

  return (
    <tr className="drilldown-row">
      <td colSpan={8}>
        <div className="drilldown-panel">
          <div className="drilldown-header">
            <div>
              <strong>{position.securityName}</strong>
              {position.ticker && <span className="muted"> ({position.ticker})</span>}
            </div>
            <button className="secondary drilldown-close" onClick={onClose}>Close</button>
          </div>

          <div className="drilldown-summary">
            <span>Qty: {formatNum(position.quantity)}</span>
            <span>Avg Cost: {formatMoney(position.costBasis, position.currency)}</span>
            {position.currentPrice !== undefined && (
              <span>Price: {formatMoney(position.currentPrice, position.currency)}</span>
            )}
            {position.currentValue !== undefined && (
              <span>Value: {formatMoney(position.currentValue, position.currency)}</span>
            )}
            {position.unrealizedGain !== undefined && (
              <span className={gainClass(position.unrealizedGain)}>
                Gain: {formatSignedMoney(position.unrealizedGain, position.currency)}
              </span>
            )}
          </div>

          {fetchState === 'loading' && <p className="muted">Loading lots...</p>}

          {fetchState === 'error' && (
            <div>
              <p className="error">{error}</p>
              <button className="secondary" onClick={loadLots}>Retry</button>
            </div>
          )}

          {fetchState === 'ready' && securityPosition && (
            <LotTable lots={securityPosition.lots} livePrice={position.currentPrice} currency={position.currency} />
          )}

          {fetchState === 'ready' && !securityPosition && (
            <p className="muted">No lot data found.</p>
          )}
        </div>
      </td>
    </tr>
  );
}

function LotTable({
  lots,
  livePrice,
  currency,
}: {
  readonly lots: readonly SecurityLot[];
  readonly livePrice: number | undefined;
  readonly currency: string;
}): JSX.Element {
  return (
    <table className="lot-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Date</th>
          <th>Action</th>
          <th className="num">Qty</th>
          <th className="num">Cost Basis</th>
          <th className="num">Value</th>
          <th className="num">Gain/Loss</th>
        </tr>
      </thead>
      <tbody>
        {lots.map((lot) => {
          const lotValue = livePrice !== undefined ? lot.quantity * livePrice : undefined;
          const lotGain = lotValue !== undefined ? lotValue - (lot.quantity * lot.costBasis) : undefined;

          return (
            <tr key={lot.recordId}>
              <td>{lot.fifoOrder}</td>
              <td>{lot.actionDate}</td>
              <td>{lot.actionType}</td>
              <td className="num">{formatNum(lot.quantity)}</td>
              <td className="num">{formatMoney(lot.costBasis, currency)}</td>
              <td className="num">{lotValue !== undefined ? formatMoney(lotValue, currency) : '—'}</td>
              <td className={`num ${gainClass(lotGain)}`}>
                {lotGain !== undefined ? formatSignedMoney(lotGain, currency) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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
