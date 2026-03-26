import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { EnrichedHoldingsPosition } from '../../../../packages/domain/src/types/marketPrice';
import styles from './AllocationDonut.module.css';

interface AllocationDonutProps {
  readonly positions: readonly EnrichedHoldingsPosition[];
  readonly currency: string;
  readonly onSelectSecurity?: (securityId: string) => void;
}

interface SliceData {
  readonly securityId: string;
  readonly name: string;
  readonly value: number;
  readonly weight: number;
}

const PALETTE = [
  '#0284c7', // sky-600
  '#0891b2', // cyan-600
  '#059669', // emerald-600
  '#7c3aed', // violet-600
  '#db2777', // pink-600
  '#d97706', // amber-600
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#9333ea', // purple-600
  '#0369a1', // sky-700
];

const MAX_SLICES = 8;

export function AllocationDonut({ positions, currency, onSelectSecurity }: AllocationDonutProps): JSX.Element {
  const { slices, noPriceCount } = useMemo(() => {
    const filtered = positions.filter((p) => p.currency === currency && p.currentValue !== undefined);
    const total = filtered.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);

    if (total === 0) return { slices: [], noPriceCount: 0 };

    const sorted: SliceData[] = filtered
      .map((p) => ({
        securityId: p.securityId,
        name: p.ticker ?? p.securityName,
        value: p.currentValue ?? 0,
        weight: ((p.currentValue ?? 0) / total) * 100,
      }))
      .sort((a, b) => b.value - a.value);

    let finalSlices: SliceData[];
    if (sorted.length > MAX_SLICES) {
      const top = sorted.slice(0, MAX_SLICES - 1);
      const othersValue = sorted.slice(MAX_SLICES - 1).reduce((sum, s) => sum + s.value, 0);
      finalSlices = [
        ...top,
        {
          securityId: '__others__',
          name: 'Others',
          value: othersValue,
          weight: (othersValue / total) * 100,
        },
      ];
    } else {
      finalSlices = sorted;
    }

    const noPriceCount = positions.filter((p) => p.currency === currency && p.currentValue === undefined).length;
    return { slices: finalSlices, noPriceCount };
  }, [positions, currency]);

  if (slices.length === 0) return <></>;

  const handleClick = (data: unknown): void => {
    if (!onSelectSecurity || typeof data !== 'object' || data === null) return;
    const securityId = (data as { securityId?: string }).securityId;
    if (securityId && securityId !== '__others__') {
      onSelectSecurity(securityId);
    }
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Allocation ({currency})</h3>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            onClick={handleClick}
            style={{ cursor: onSelectSecurity ? 'pointer' : 'default' }}
          >
            {slices.map((slice, index) => (
              <Cell
                key={slice.securityId}
                fill={PALETTE[index % PALETTE.length]}
                stroke="none"
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [
              typeof value === 'number'
                ? value.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
                : String(value ?? ''),
              'Value',
            ]}
            contentStyle={{
              fontSize: '13px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-sm)',
            }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value: string, entry: unknown) => {
              const e = entry as { payload?: SliceData };
              const pct = e.payload?.weight;
              return pct !== undefined ? `${value} (${pct.toFixed(1)}%)` : value;
            }}
            wrapperStyle={{ fontSize: '13px' }}
          />
        </PieChart>
      </ResponsiveContainer>
      {noPriceCount > 0 && (
        <p className={styles.footnote}>
          {noPriceCount} position{noPriceCount > 1 ? 's' : ''} excluded (no price)
        </p>
      )}
    </div>
  );
}
