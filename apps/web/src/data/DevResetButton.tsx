import { useState } from 'react';
import { domain } from '../domain/bootstrap';
import styles from './DevResetButton.module.css';

interface DevResetButtonProps {
  readonly onReset: () => void;
}

type ResetState = 'idle' | 'confirming' | 'resetting' | 'done' | 'error';

export function DevResetButton({ onReset }: DevResetButtonProps): JSX.Element {
  const [state, setState] = useState<ResetState>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleClick = (): void => {
    setState('confirming');
    setError(null);
  };

  const handleCancel = (): void => {
    setState('idle');
  };

  const handleConfirm = (): void => {
    setState('resetting');

    domain.resetAllData()
      .then(() => {
        setState('done');
        onReset();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Reset failed');
        setState('error');
      });
  };

  if (state === 'done') {
    return <p className={styles.success}>All data reset. Reload to start fresh.</p>;
  }

  return (
    <div className={styles.container}>
      {state === 'idle' || state === 'error' ? (
        <>
          <button
            type="button"
            className={styles.resetButton}
            onClick={handleClick}
            aria-label="Reset all portfolio data"
          >
            Reset all data
          </button>
          <span className={styles.hint}>Wipes all imports, lots, and ticker mappings. Configuration is preserved.</span>
          {state === 'error' && error && <p className={styles.error}>{error}</p>}
        </>
      ) : state === 'confirming' ? (
        <div className={styles.confirm} role="alertdialog" aria-modal="true" aria-label="Confirm reset">
          <p className={styles.confirmText}>
            This will delete all import runs, holding lots, raw rows, and ticker mappings.
            Provider configuration is preserved. This cannot be undone (re-import to restore).
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.confirmButton} onClick={handleConfirm}>
              Yes, reset everything
            </button>
            <button type="button" className={styles.cancelButton} onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.hint}>Resetting...</p>
      )}
    </div>
  );
}
