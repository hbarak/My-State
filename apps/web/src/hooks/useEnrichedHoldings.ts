import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnrichedHoldingsState } from '../../../../packages/domain/src/types/marketPrice';
import { domain } from '../domain/bootstrap';

export type EnrichedHoldingsStatus = 'loading' | 'ready' | 'error';

export interface UseEnrichedHoldingsResult {
  readonly state: EnrichedHoldingsStatus;
  readonly data: EnrichedHoldingsState | null;
  readonly error: string | null;
  readonly refetch: () => void;
}

export function useEnrichedHoldings(providerId: string): UseEnrichedHoldingsResult {
  const [status, setStatus] = useState<EnrichedHoldingsStatus>('loading');
  const [data, setData] = useState<EnrichedHoldingsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const doFetch = useCallback(
    (reqId: number) => {
      setStatus('loading');
      setError(null);

      domain.financialStateService
        .getEnrichedHoldings({ providerId })
        .then((result) => {
          if (reqId !== requestIdRef.current) return;
          setData(result);
          setStatus('ready');
        })
        .catch((err: unknown) => {
          if (reqId !== requestIdRef.current) return;
          setError(err instanceof Error ? err.message : 'Failed to load portfolio');
          setStatus('error');
        });
    },
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

  return { state: status, data, error, refetch };
}
