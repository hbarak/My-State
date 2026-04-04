import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnrichedHoldingsState } from '../../../../packages/domain/src/types/marketPrice';
import { QuotaExceededError } from '../adapters/EodhdPriceFetcher';
import { domain } from '../domain/bootstrap';

export type EnrichedHoldingsStatus = 'loading' | 'ready' | 'error';

export interface UseEnrichedHoldingsResult {
  readonly state: EnrichedHoldingsStatus;
  readonly data: EnrichedHoldingsState | null;
  readonly error: string | null;
  readonly priceQuotaExceeded: boolean;
  readonly refetch: () => void;
}

// Module-level cache: keeps the last fetched result per providerId so that
// re-mounting (e.g. tab switch) shows stale data while revalidating instead
// of blanking the net worth display. Only cleared on explicit reset.
const cachedData = new Map<string, EnrichedHoldingsState>();

export function useEnrichedHoldings(providerId: string): UseEnrichedHoldingsResult {
  const [status, setStatus] = useState<EnrichedHoldingsStatus>(() =>
    cachedData.has(providerId) ? 'ready' : 'loading',
  );
  const [data, setData] = useState<EnrichedHoldingsState | null>(
    () => cachedData.get(providerId) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [priceQuotaExceeded, setPriceQuotaExceeded] = useState(false);
  const requestIdRef = useRef(0);

  const doFetch = useCallback(
    (reqId: number) => {
      setStatus('loading');
      setError(null);
      setPriceQuotaExceeded(false);

      domain.financialStateService
        .getEnrichedHoldings({ providerId })
        .then((result) => {
          if (reqId !== requestIdRef.current) return;
          cachedData.set(providerId, result);
          setData(result);
          setStatus('ready');
        })
        .catch((err: unknown) => {
          if (reqId !== requestIdRef.current) return;
          if (err instanceof QuotaExceededError) {
            // Quota exceeded: keep existing data visible, show inline warning only
            setPriceQuotaExceeded(true);
            setStatus(data !== null ? 'ready' : 'error');
            return;
          }
          setError(err instanceof Error ? err.message : 'Failed to load portfolio');
          setStatus('error');
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providerId],
  );

  useEffect(() => {
    const reqId = ++requestIdRef.current;
    doFetch(reqId);
  }, [doFetch]);

  const refetch = useCallback(() => {
    const reqId = ++requestIdRef.current;
    doFetch(reqId);
  }, [doFetch]);

  return { state: status, data, error, priceQuotaExceeded, refetch };
}
