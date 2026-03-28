import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnrichedHoldingsPosition } from '../../../../packages/domain/src/types/marketPrice';
import type { SecurityPosition, SecurityLot } from '../../../../packages/domain/src/services/SecurityLotQueryService';
import { domain } from '../domain/bootstrap';
import { AccountSection } from './AccountSection';
import { PositionProvenance } from './PositionProvenance';
import styles from './SecurityDrillDown.module.css';

interface SecurityDrillDownProps {
  readonly position: EnrichedHoldingsPosition;
  readonly providerId: string;
  readonly onClose: () => void;
  readonly onPortfolioChanged?: () => void;
}

type LotFetchState = 'loading' | 'ready' | 'error';

export function SecurityDrillDown({ position, providerId, onClose, onPortfolioChanged }: SecurityDrillDownProps): JSX.Element {
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
    <tr className={styles.drilldownRow}>
      <td colSpan={8}>
        <div className={styles.panel} data-testid="security-drilldown">
          <div className={styles.header}>
            <div>
              <strong>{position.securityName}</strong>
              {position.ticker && <span className={styles.muted}> ({position.ticker})</span>}
            </div>
            <button className={styles.closeButton} onClick={onClose}>Close</button>
          </div>

          <div className={styles.summary}>
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
                Gain: {gainArrow(position.unrealizedGain)} {formatSignedMoney(position.unrealizedGain, position.currency)}
              </span>
            )}
          </div>

          {fetchState === 'loading' && <p className={styles.muted}>Loading lots...</p>}

          {fetchState === 'error' && (
            <div>
              <p className={styles.errorText}>{error}</p>
              <button className={styles.retryButton} onClick={loadLots}>Retry</button>
            </div>
          )}

          {fetchState === 'ready' && securityPosition && securityPosition.accountBreakdown.length > 1 && (
            securityPosition.accountBreakdown.map((subtotal) => (
              <AccountSection
                key={subtotal.accountId}
                subtotal={subtotal}
                currency={position.currency}
                livePrice={position.currentPrice}
                renderLotTable={renderLotTable}
                defaultOpen={false}
              />
            ))
          )}

          {fetchState === 'ready' && securityPosition && securityPosition.accountBreakdown.length <= 1 && (
            <LotTable lots={securityPosition.lots} livePrice={position.currentPrice} currency={position.currency} />
          )}

          {fetchState === 'ready' && !securityPosition && (
            <p className={styles.muted}>No lot data found.</p>
          )}

          <PositionProvenance
            securityId={position.securityId}
            onContributionDeleted={() => {
              onPortfolioChanged?.();
              loadLots();
            }}
          />
        </div>
      </td>
    </tr>
  );
}

function renderLotTable(lots: readonly SecurityLot[], livePrice: number | undefined, currency: string): JSX.Element {
  return <LotTable lots={lots} livePrice={livePrice} currency={currency} />;
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
    <table className={styles.lotTable}>
      <thead>
        <tr>
          <th>#</th>
          <th>Date</th>
          <th>Action</th>
          <th className={styles.num}>Qty</th>
          <th className={styles.num}>Cost Basis</th>
          <th className={styles.num}>Value</th>
          <th className={styles.num}>Gain/Loss</th>
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
              <td className={styles.num}>{formatNum(lot.quantity)}</td>
              <td className={styles.num}>{formatMoney(lot.costBasis, currency)}</td>
              <td className={styles.num}>{lotValue !== undefined ? formatMoney(lotValue, currency) : '—'}</td>
              <td className={`${styles.num} ${gainClass(lotGain)}`}>
                {lotGain !== undefined ? `${gainArrow(lotGain)} ${formatSignedMoney(lotGain, currency)}` : '—'}
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
  if (gain > 0) return styles.gainPositive;
  if (gain < 0) return styles.gainNegative;
  return '';
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

function formatSignedMoney(value: number, currency: string): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + formatMoney(value, currency);
}
