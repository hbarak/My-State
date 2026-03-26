import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportRunProvenance } from '../../../../packages/domain/src/repositories/portfolioRepository';
import { domain } from '../domain/bootstrap';
import styles from './PositionProvenance.module.css';

interface PositionProvenanceProps {
  readonly securityId: string;
  readonly onContributionDeleted: () => void;
}

type FetchState = 'loading' | 'ready' | 'error';
type DeleteState = 'idle' | 'confirming' | 'deleting';

interface DeleteTarget {
  readonly runId: string;
  readonly importDate: string;
}

export function PositionProvenance({ securityId, onContributionDeleted }: PositionProvenanceProps): JSX.Element {
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [provenance, setProvenance] = useState<readonly ImportRunProvenance[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState>('idle');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadProvenance = useCallback(() => {
    const reqId = ++requestRef.current;
    setFetchState('loading');
    setFetchError(null);

    domain.getProvenanceForSecurity(securityId)
      .then((result) => {
        if (reqId !== requestRef.current) return;
        setProvenance(result);
        setFetchState('ready');
      })
      .catch((err: unknown) => {
        if (reqId !== requestRef.current) return;
        setFetchError(err instanceof Error ? err.message : 'Failed to load provenance');
        setFetchState('error');
      });
  }, [securityId]);

  useEffect(() => {
    loadProvenance();
  }, [loadProvenance]);

  const handleDeleteClick = (entry: ImportRunProvenance): void => {
    setDeleteTarget({ runId: entry.runId, importDate: entry.importDate });
    setDeleteState('confirming');
    setDeleteError(null);
  };

  const handleDeleteCancel = (): void => {
    setDeleteState('idle');
    setDeleteTarget(null);
  };

  const handleDeleteConfirm = (): void => {
    if (!deleteTarget) return;
    setDeleteState('deleting');

    domain.deleteImportRunContribution(deleteTarget.runId)
      .then(() => {
        setDeleteState('idle');
        setDeleteTarget(null);
        onContributionDeleted();
        loadProvenance();
      })
      .catch((err: unknown) => {
        setDeleteError(err instanceof Error ? err.message : 'Delete failed');
        setDeleteState('idle');
      });
  };

  return (
    <div className={styles.container} data-testid="position-provenance">
      <h4 className={styles.title}>Import Contributions</h4>

      {fetchState === 'loading' && <p className={styles.muted}>Loading...</p>}
      {fetchState === 'error' && <p className={styles.error}>{fetchError}</p>}

      {fetchState === 'ready' && provenance.length === 0 && (
        <p className={styles.muted}>No import contributions found.</p>
      )}

      {fetchState === 'ready' && provenance.length > 0 && (
        <ul className={styles.list}>
          {provenance.map((entry) => (
            <li key={entry.runId} className={styles.entry}>
              <div className={styles.entryInfo}>
                <span className={styles.runDate}>{formatDate(entry.importDate)}</span>
                <span className={styles.runMeta}>
                  Account: <code className={styles.code}>{entry.accountId}</code>
                  {' · '}{entry.lotCount} lot{entry.lotCount !== 1 ? 's' : ''}
                </span>
                <span className={styles.runId} title={entry.runId}>
                  run: {entry.runId.slice(-8)}
                </span>
              </div>
              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => handleDeleteClick(entry)}
                disabled={deleteState === 'deleting'}
                aria-label={`Delete contribution from import on ${formatDate(entry.importDate)}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {deleteError && <p className={styles.error}>{deleteError}</p>}

      {deleteState === 'confirming' && deleteTarget && (
        <div className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-label="Confirm delete">
          <p className={styles.confirmText}>
            Delete the contribution from <strong>{formatDate(deleteTarget.importDate)}</strong>?
            This soft-deletes all lots from that run. Re-importing the same CSV will restore them.
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.confirmDeleteButton}
              onClick={handleDeleteConfirm}
            >
              Delete
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleDeleteCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteState === 'deleting' && <p className={styles.muted}>Deleting...</p>}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
