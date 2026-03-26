import { useCallback, useEffect, useState } from 'react';
import { domain } from '../domain/bootstrap';
import type { ImportRunListItem } from '../../../../packages/domain/src/types/financialState';
import { ImportRunDetail } from './ImportRunDetail';
import { DevResetButton } from './DevResetButton';
import styles from './DataTab.module.css';

type LoadState = 'loading' | 'loaded' | 'error';

export function DataTab(): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [runs, setRuns] = useState<readonly ImportRunListItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadRuns = useCallback(() => {
    let cancelled = false;
    setLoadState('loading');
    void domain.importRunQueryService
      .listAllRuns()
      .then((items) => {
        if (cancelled) return;
        setRuns(items);
        setLoadState('loaded');
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMsg(error instanceof Error ? error.message : 'Failed to load import runs');
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return loadRuns();
  }, [loadRuns]);

  return (
    <div className={styles.container} data-testid="data-tab">
      <h2 className={styles.heading}>Import History</h2>
      <p className={styles.subtitle}>All CSV uploads and API syncs, newest first.</p>

      {loadState === 'loading' && <p className={styles.msg}>Loading…</p>}
      {loadState === 'error' && <p className={styles.errorMsg}>{errorMsg}</p>}
      {loadState === 'loaded' && runs.length === 0 && (
        <p className={styles.msg}>No import runs yet. Upload a CSV or run an API sync to get started.</p>
      )}
      {loadState === 'loaded' && runs.length > 0 && (
        <div className={styles.list}>
          {runs.map((item) => (
            <ImportRunDetail key={item.run.id} item={item} />
          ))}
        </div>
      )}

      <div className={styles.devZone}>
        <h3 className={styles.devHeading}>Developer Tools</h3>
        <DevResetButton onReset={loadRuns} />
      </div>
    </div>
  );
}
