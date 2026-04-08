import styles from './MigrationPrompt.module.css';
import { MIGRATION_TOTAL_STEPS } from './localStorageMigration';

type MigrationStatus = 'idle' | 'running' | 'done' | 'error';

interface MigrationPromptProps {
  status: MigrationStatus;
  step: number;
  error: string | null;
  onConfirm: () => void;
  onRetry: () => void;
}

export function MigrationPrompt({
  status,
  step,
  error,
  onConfirm,
  onRetry,
}: MigrationPromptProps): JSX.Element {
  const progressPct = Math.round((step / MIGRATION_TOTAL_STEPS) * 100);

  if (status === 'idle') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h2 className={styles.title}>Migrate to cloud storage</h2>
          <p className={styles.body}>
            Your portfolio data is currently stored locally in this browser. Migrating it to cloud storage lets you access
            it from any device and keeps it safe if you clear browser data.
          </p>
          <p className={styles.body}>This is a one-time step. Your local data will remain as a backup.</p>
          <button className={styles.button} onClick={onConfirm}>
            Migrate now
          </button>
        </div>
      </div>
    );
  }

  if (status === 'running') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h2 className={styles.title}>Migrating your data to cloud storage…</h2>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          </div>
          <p className={styles.progressLabel}>{step} of {MIGRATION_TOTAL_STEPS} tables</p>
        </div>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <p className={styles.success}>Your data has been migrated. Welcome to cloud sync!</p>
        </div>
      </div>
    );
  }

  // error
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.titleError}>⚠ Migration failed</h2>
        <p className={styles.body}>Your local data is unchanged.</p>
        {error && <p className={styles.errorDetail}>{error}</p>}
        <button className={styles.button} onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}
