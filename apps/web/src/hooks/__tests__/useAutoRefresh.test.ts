// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoRefresh } from '../useAutoRefresh';

// Vitest fake timers
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const noop = (): void => {};

describe('useAutoRefresh', () => {
  it('does not call onRefresh when disabled', () => {
    const onRefresh = vi.fn();
    renderHook(() =>
      useAutoRefresh({
        enabled: false,
        intervalMs: 1000,
        quotaExhausted: false,
        onRefresh,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('calls onRefresh after intervalMs when enabled', () => {
    const onRefresh = vi.fn();
    renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 3000,
        quotaExhausted: false,
        onRefresh,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onRefresh multiple times at interval', () => {
    const onRefresh = vi.fn();
    renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 2000,
        quotaExhausted: false,
        onRefresh,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(onRefresh).toHaveBeenCalledTimes(3);
  });

  it('does not call onRefresh when quotaExhausted is true', () => {
    const onRefresh = vi.fn();
    renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 1000,
        quotaExhausted: true,
        onRefresh,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('returns isActive=true when enabled and not quota exhausted', () => {
    const { result } = renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 5000,
        quotaExhausted: false,
        onRefresh: noop,
      }),
    );

    expect(result.current.isActive).toBe(true);
  });

  it('returns isActive=false when disabled', () => {
    const { result } = renderHook(() =>
      useAutoRefresh({
        enabled: false,
        intervalMs: 5000,
        quotaExhausted: false,
        onRefresh: noop,
      }),
    );

    expect(result.current.isActive).toBe(false);
  });

  it('returns isActive=false when quotaExhausted', () => {
    const { result } = renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 5000,
        quotaExhausted: true,
        onRefresh: noop,
      }),
    );

    expect(result.current.isActive).toBe(false);
  });

  it('clears interval on unmount', () => {
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() =>
      useAutoRefresh({
        enabled: true,
        intervalMs: 1000,
        quotaExhausted: false,
        onRefresh,
      }),
    );

    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
