import { useMemo } from 'react';
import type { EnrichedHoldingsPosition } from '../../../../packages/domain/src/types/marketPrice';

interface AllocationChartProps {
  readonly positions: readonly EnrichedHoldingsPosition[];
  readonly currency: string;
}

interface AllocationRow {
  readonly securityId: string;
  readonly securityName: string;
  readonly ticker: string | undefined;
  readonly value: number;
  readonly weight: number;
}

export function AllocationChart({ positions, currency }: AllocationChartProps): JSX.Element {
  const { rows, noPriceCount } = useMemo(() => {
    const filtered = positions.filter(
      (p) => p.currency === currency && p.currentValue !== undefined,
    );
    const totalValue = filtered.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);
    const computedRows: readonly AllocationRow[] =
      totalValue === 0
        ? []
        : filtered
            .map((p) => ({
              securityId: p.securityId,
              securityName: p.securityName,
              ticker: p.ticker,
              value: p.currentValue ?? 0,
              weight: ((p.currentValue ?? 0) / totalValue) * 100,
            }))
            .sort((a, b) => b.weight - a.weight);
    const computedNoPriceCount = positions.filter(
      (p) => p.currency === currency && p.currentValue === undefined,
    ).length;
    return { rows: computedRows, noPriceCount: computedNoPriceCount };
  }, [positions, currency]);

  if (rows.length === 0) {
    return <></>;
  }

  return (
    <div className="allocation-chart">
      <h3>Allocation ({currency})</h3>
      <div className="allocation-bars">
        {rows.map((row) => (
          <div key={row.securityId} className="allocation-row">
            <span className="allocation-label">
              {row.ticker ?? row.securityName}
            </span>
            <div className="allocation-bar-track">
              <div
                className="allocation-bar-fill"
                style={{ width: `${Math.max(row.weight, 1)}%` }}
              />
            </div>
            <span className="allocation-pct">{row.weight.toFixed(1)}%</span>
          </div>
        ))}
      </div>
      {noPriceCount > 0 && (
        <p className="muted allocation-footnote">
          {noPriceCount} position{noPriceCount > 1 ? 's' : ''} excluded (no price)
        </p>
      )}
    </div>
  );
}
