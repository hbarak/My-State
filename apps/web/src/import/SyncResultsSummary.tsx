import type { ApiSyncSummary } from '../../../../packages/domain/src/services/PsagotApiSyncService';
import type { Account } from '../../../../packages/domain/src/types/account';
import styles from './ApiSyncCard.module.css';

interface SyncResultsSummaryProps {
  readonly summary: ApiSyncSummary;
  readonly accounts: readonly Account[];
  readonly newAccountCount: number;
  readonly onSyncAgain: () => void;
}

export function SyncResultsSummary({
  summary,
  accounts,
  newAccountCount,
  onSyncAgain,
}: SyncResultsSummaryProps): JSX.Element {
  const now = new Date();
  const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={styles.results}>
      <h4 className={styles.resultsHeading}>Sync Complete</h4>

      <div className={styles.resultGrid}>
        <div className={styles.resultBox}>
          <span className={styles.resultLabel}>Accounts</span>
          <span className={styles.resultValue}>{summary.accountsSynced}</span>
        </div>
        <div className={styles.resultBox}>
          <span className={styles.resultLabel}>Positions</span>
          <span className={styles.resultValue}>
            {summary.totalNewRecords + summary.totalUpdatedRecords}
          </span>
        </div>
        <div className={styles.resultBox}>
          <span className={styles.resultLabel}>Updated</span>
          <span className={styles.resultValue}>{timeStr}</span>
        </div>
      </div>

      {newAccountCount > 0 && (
        <p className={styles.newAccounts}>
          {newAccountCount} new account{newAccountCount !== 1 ? 's' : ''} discovered and created.
        </p>
      )}

      {summary.accountsSynced > 0 && (
        <ul className={styles.accountList}>
          {summary.importRuns.map((run) => {
            const account = accounts.find((a) => a.id === run.accountId);
            const name = account?.name ?? run.accountId;
            return (
              <li key={run.id}>
                {run.accountId} {name !== run.accountId ? `"${name}"` : ''} — {run.importedCount} position{run.importedCount !== 1 ? 's' : ''}
              </li>
            );
          })}
        </ul>
      )}

      {summary.errors.length > 0 && (
        <div className={styles.errorBox}>
          <p>
            Sync partially completed. {summary.accountsSynced} of{' '}
            {summary.accountsSynced + summary.errors.length} accounts updated.
          </p>
          <ul className={styles.accountList}>
            {summary.errors.map((e) => (
              <li key={e.accountId}>
                {e.accountId}: {e.error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" className={styles.secondaryButton} onClick={onSyncAgain}>
        Sync Again
      </button>
    </div>
  );
}
