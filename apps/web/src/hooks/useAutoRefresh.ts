import { useEffect, useRef } from 'react';

export interface AutoRefreshOptions {
  /** Whether auto-refresh is enabled. */
  readonly enabled: boolean;
  /** Interval in milliseconds between refreshes. */
  readonly intervalMs: number;
  /** When true, auto-refresh is paused (e.g. EODHD quota exhausted). */
  readonly quotaExhausted: boolean;
  /** Callback invoked on each refresh tick. */
  readonly onRefresh: () => void;
}

export interface AutoRefreshResult {
  /** True when the interval is active (enabled and not quota-exhausted). */
  readonly isActive: boolean;
}

/**
 * Fires `onRefresh` every `intervalMs` when enabled and quota not exhausted.
 * Cleans up the interval on unmount or when options change.
 */
export function useAutoRefresh({
  enabled,
  intervalMs,
  quotaExhausted,
  onRefresh,
}: AutoRefreshOptions): AutoRefreshResult {
  const isActive = enabled && !quotaExhausted;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!isActive) return;

    const id = setInterval(() => {
      onRefreshRef.current();
    }, intervalMs);

    return () => clearInterval(id);
  }, [isActive, intervalMs]);

  return { isActive };
}
