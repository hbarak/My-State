import { useState } from 'react';
import type { ImportRunListItem } from '../../../../packages/domain/src/types/financialState';
import type { RawImportRow } from '../../../../packages/domain/src/types/portfolio';
import type { ProviderHoldingRecord } from '../../../../packages/domain/src/types/portfolio';
import { domain } from '../domain/bootstrap';
import { JsonViewer } from './JsonViewer';
import styles from './ImportRunDetail.module.css';

interface ImportRunDetailProps {
  readonly item: ImportRunListItem;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

interface ParsedRawRow {
  readonly rowNumber: number;
  readonly isValid: boolean;
  readonly errorCode: string | undefined;
  readonly errorMessage: string | undefined;
  readonly payload: unknown;
}

function parseRawRows(rows: readonly RawImportRow[]): ParsedRawRow[] {
  return rows.map((row) => {
    let payload: unknown;
    try {
      payload = JSON.parse(row.rowPayload);
    } catch {
      payload = row.rowPayload;
    }
    return {
      rowNumber: row.rowNumber,
      isValid: row.isValid,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      payload,
    };
  });
}

export function ImportRunDetail({ item }: ImportRunDetailProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [rawRows, setRawRows] = useState<readonly RawImportRow[]>([]);
  const [mappedRecords, setMappedRecords] = useState<readonly ProviderHoldingRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggle = (): void => {
    if (!expanded && loadState === 'idle') {
      void loadDetail();
    }
    setExpanded((prev) => !prev);
  };

  const loadDetail = async (): Promise<void> => {
    setLoadState('loading');
    try {
      const [rows, lots] = await Promise.all([
        domain.importRunQueryService.listRawRowsForRun(item.run.id),
        domain.importRunQueryService.listLotsForRun(item.run.id),
      ]);
      setRawRows(rows);
      setMappedRecords(lots);
      setLoadState('loaded');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to load run detail');
      setLoadState('error');
    }
  };

  const sourceLabel = item.sourceType === 'api' ? 'API' : 'CSV';
  const dateStr = formatDate(item.run.startedAt);
  const statusLabel = item.run.status === 'success' ? 'OK' : item.run.status;
  const statusClass = item.run.status === 'success' ? styles.statusOk : styles.statusFailed;

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.header}
        onClick={toggle}
        aria-expanded={expanded}
        data-testid={`import-run-${item.run.id}`}
      >
        <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>
        <span className={styles.meta}>
          <span className={styles.date}>{dateStr}</span>
          <span className={styles.badge}>{sourceLabel}</span>
          <span className={styles.account}>{item.accountLabel}</span>
        </span>
        <span className={styles.counts}>
          {item.rawRowCounts
            ? `${item.rawRowCounts.total} rows · ${item.rawRowCounts.valid} valid`
            : 'legacy run'}
        </span>
        <span className={`${styles.status} ${statusClass}`}>{statusLabel}</span>
      </button>

      {expanded && (
        <div className={styles.body}>
          {loadState === 'loading' && <p className={styles.loadMsg}>Loading…</p>}
          {loadState === 'error' && <p className={styles.errorMsg}>{errorMsg}</p>}
          {loadState === 'loaded' && (
            <div className={styles.panels}>
              <JsonViewer
                label="Run metadata"
                data={{ id: item.run.id, source: item.sourceType, account: item.accountLabel, status: item.run.status, startedAt: item.run.startedAt, counts: item.rawRowCounts }}
              />
              <JsonViewer
                label={`Raw rows (${rawRows.length})`}
                data={parseRawRows(rawRows)}
              />
              {mappedRecords.length > 0 ? (
                <JsonViewer
                  label={`Mapped records (${mappedRecords.length})`}
                  data={mappedRecords}
                />
              ) : (
                <div className={styles.emptyPanel}>
                  <p className={styles.emptyLabel}>Mapped records</p>
                  <p className={styles.emptyMsg}>No mapped records</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
