import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { EnrichedHoldingsPosition } from '../../../../packages/domain/src/types/marketPrice';
import type { SecurityPosition, SecurityLot } from '../../../../packages/domain/src/services/SecurityLotQueryService';
import { useEnrichedHoldings } from '../hooks/useEnrichedHoldings';
import { domain } from '../domain/bootstrap';
import { formatQty } from './formatters';
import { AccountSection } from './AccountSection';
import styles from './StockDetailPage.module.css';

interface StockDetailPageProps {
  readonly securityId: string;
}

export function StockDetailPage({ securityId }: StockDetailPageProps): JSX.Element {
  const [, navigate] = useLocation();
  const { data: enrichedState } = useEnrichedHoldings();
  const [securityPosition, setSecurityPosition] = useState<SecurityPosition | null>(null);
  const [fetchState, setFetchState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const decodedId = decodeURIComponent(securityId);

  const enrichedPosition = enrichedState?.positions.find(
    (p) => p.securityId === decodedId,
  );

  const totalPortfolioValue = enrichedState?.positions.reduce(
    (sum, p) => sum + (p.currentValue ?? 0),
    0,
  ) ?? 0;

  const allocationPct = enrichedPosition?.currentValue !== undefined && totalPortfolioValue > 0
    ? enrichedPosition.currentValue / totalPortfolioValue
    : undefined;

  const loadLots = useCallback(() => {
    if (!enrichedPosition) return;
    const reqId = ++requestRef.current;
    setFetchState('loading');
    setError(null);

    domain.securityLotQueryService
      .getSecurityLots({
        providerId: enrichedPosition.providerId,
        securityId: decodedId,
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
  }, [decodedId, enrichedPosition]);

  useEffect(() => {
    loadLots();
  }, [loadLots]);

  return (
    <div className={styles.page}>
      <button className={styles.backButton} onClick={() => navigate('/')}>
        ← Back to portfolio
      </button>

      {enrichedPosition ? (
        <>
          <DetailHeader
            position={enrichedPosition}
            allocationPct={allocationPct}
          />

          {fetchState === 'ready' && securityPosition && (
            <>
              <LotLayersView
                lots={securityPosition.lots}
                livePrice={enrichedPosition.currentPrice}
                currency={enrichedPosition.currency}
              />

              {securityPosition.accountBreakdown.length > 1 ? (
                <div className={styles.accountBreakdown}>
                  <h3 className={styles.sectionTitle}>Accounts</h3>
                  {securityPosition.accountBreakdown.map((subtotal) => (
                    <AccountSection
                      key={subtotal.accountId}
                      subtotal={subtotal}
                      currency={enrichedPosition.currency}
                      livePrice={enrichedPosition.currentPrice}
                      renderLotTable={renderLotTable}
                      defaultOpen={false}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.lotsSection}>
                  <h3 className={styles.sectionTitle}>Lots</h3>
                  <LotTable
                    lots={securityPosition.lots}
                    livePrice={enrichedPosition.currentPrice}
                    currency={enrichedPosition.currency}
                  />
                </div>
              )}
            </>
          )}

          {fetchState === 'loading' && <p className={styles.muted}>Loading lots...</p>}

          {fetchState === 'error' && (
            <div>
              <p className={styles.errorText}>{error}</p>
              <button className={styles.retryButton} onClick={loadLots}>Retry</button>
            </div>
          )}
        </>
      ) : (
        <p className={styles.muted}>Position not found for security {decodedId}.</p>
      )}
    </div>
  );
}

function DetailHeader({
  position,
  allocationPct,
}: {
  readonly position: EnrichedHoldingsPosition;
  readonly allocationPct: number | undefined;
}): JSX.Element {
  return (
    <div className={styles.header}>
      <div className={styles.headerMain}>
        <h2 className={styles.securityName}>{position.securityName}</h2>
        {position.ticker && <span className={styles.ticker}>{position.ticker}</span>}
      </div>

      <div className={styles.headerStats}>
        {position.currentPrice !== undefined && (
          <div className={styles.stat}>
            <span className={styles.statLabel}>Price</span>
            <span className={styles.statValue}>{formatMoney(position.currentPrice, position.currency)}</span>
          </div>
        )}

        {position.currentValue !== undefined && (
          <div className={styles.stat}>
            <span className={styles.statLabel}>Value</span>
            <span className={styles.statValue}>{formatMoney(position.currentValue, position.currency)}</span>
          </div>
        )}

        {position.unrealizedGain !== undefined && (
          <div className={styles.stat}>
            <span className={styles.statLabel}>Gain/Loss</span>
            <span className={`${styles.statValue} ${position.unrealizedGain >= 0 ? styles.gainPositive : styles.gainNegative}`}>
              {position.unrealizedGain >= 0 ? '▲' : '▼'}{' '}
              {formatSignedMoney(position.unrealizedGain, position.currency)}
              {position.unrealizedGainPct !== undefined && (
                <span className={styles.gainPct}> ({formatPct(position.unrealizedGainPct)})</span>
              )}
            </span>
          </div>
        )}

        {allocationPct !== undefined && (
          <div className={styles.stat}>
            <span className={styles.statLabel}>Allocation</span>
            <span className={styles.statValue}>{formatPct(allocationPct)}</span>
          </div>
        )}

        <div className={styles.stat}>
          <span className={styles.statLabel}>Qty</span>
          <span className={styles.statValue}>{formatQty(position.quantity)}</span>
        </div>

        <div className={styles.stat}>
          <span className={styles.statLabel}>Avg Cost</span>
          <span className={styles.statValue}>{formatMoney(position.costBasis, position.currency)}</span>
        </div>
      </div>
    </div>
  );
}

function LotLayersView({
  lots,
  livePrice,
  currency,
}: {
  readonly lots: readonly SecurityLot[];
  readonly livePrice: number | undefined;
  readonly currency: string;
}): JSX.Element {
  if (lots.length === 0) return <></>;

  const maxQty = Math.max(...lots.map((l) => l.quantity));

  return (
    <div className={styles.layersSection}>
      <h3 className={styles.sectionTitle}>Layers</h3>
      <div className={styles.layersContainer}>
        {[...lots].reverse().map((lot) => {
          const gain = livePrice !== undefined
            ? (livePrice - lot.costBasis) * lot.quantity
            : undefined;
          const isGain = gain !== undefined && gain >= 0;

          return (
            <div
              key={lot.recordId}
              className={`${styles.layerBar} ${gain !== undefined ? (isGain ? styles.layerGain : styles.layerLoss) : styles.layerNeutral}`}
              style={{ flex: lot.quantity / maxQty }}
              title={`${lot.actionDate} · Qty: ${formatQty(lot.quantity)} · Cost: ${formatMoney(lot.costBasis, currency)}${gain !== undefined ? ` · Gain: ${formatSignedMoney(gain, currency)}` : ''}`}
            >
              {lot.quantity >= maxQty * 0.15 && (
                <span className={styles.layerLabel}>
                  {formatQty(lot.quantity)} @ {formatMoney(lot.costBasis, currency)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
              <td className={styles.num}>{formatQty(lot.quantity)}</td>
              <td className={styles.num}>{formatMoney(lot.costBasis, currency)}</td>
              <td className={styles.num}>{lotValue !== undefined ? formatMoney(lotValue, currency) : '—'}</td>
              <td className={`${styles.num} ${gainClass(lotGain)}`}>
                {lotGain !== undefined ? `${lotGain >= 0 ? '▲' : '▼'} ${formatSignedMoney(lotGain, currency)}` : '—'}
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

function formatSignedMoney(value: number, currency: string): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + formatMoney(value, currency);
}

function formatPct(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return prefix + (value * 100).toFixed(2) + '%';
}
