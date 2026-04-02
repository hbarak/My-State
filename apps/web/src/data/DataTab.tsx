import { useCallback, useEffect, useState } from 'react';
import { domain } from '../domain/bootstrap';
import type { ImportRunListItem } from '../../../../packages/domain/src/types/financialState';
import type { Account } from '../../../../packages/domain/src/types/account';
import { ImportRunDetail } from './ImportRunDetail';
import { DevResetButton } from './DevResetButton';
import { AddDataWizard } from '../import/AddDataWizard';
import type { PreviewSummary, CommitSummary, ImportStatus } from '../import/AddDataWizard';
import styles from './DataTab.module.css';

interface DataTabProps {
  // CSV wizard props (passed through from App)
  readonly accounts: readonly Account[];
  readonly selectedAccountId: string | null;
  readonly onSelectAccount: (accountId: string) => void;
  readonly onRenameAccount: (accountId: string, name: string) => Promise<void>;
  readonly onAccountsChanged: () => void;
  readonly onFileSelected: (file: File) => void;
  readonly onReset: () => void;
  readonly disabled: boolean;
  readonly importStatus: ImportStatus;
  readonly noticeMessage: string | null;
  readonly failureMessage: string | null;
  readonly previewSummary: PreviewSummary | null;
  readonly commitSummary: CommitSummary | null;
  readonly onContinueWithValidRows: () => void;
  readonly onCancelImport: () => void;
  readonly onUndoLastImport: () => void;
  readonly onNavigateToPortfolio: () => void;
}

type LoadState = 'loading' | 'loaded' | 'error';

export function DataTab({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onRenameAccount,
  onAccountsChanged,
  onFileSelected,
  onReset,
  disabled,
  importStatus,
  noticeMessage,
  failureMessage,
  previewSummary,
  commitSummary,
  onContinueWithValidRows,
  onCancelImport,
  onUndoLastImport,
  onNavigateToPortfolio,
}: DataTabProps): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [runs, setRuns] = useState<readonly ImportRunListItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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

  // Reload history after a successful import
  useEffect(() => {
    if (importStatus === 'completed') {
      loadRuns();
    }
  }, [importStatus, loadRuns]);

  const handleWizardReset = (): void => {
    onReset();
  };

  const handleCommitSummaryAcknowledge = (): void => {
    onNavigateToPortfolio();
  };

  return (
    <div className={styles.container} data-testid="data-tab">
      <AddDataWizard
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelectAccount={onSelectAccount}
        onRenameAccount={onRenameAccount}
        onAccountsChanged={onAccountsChanged}
        onFileSelected={onFileSelected}
        onReset={handleWizardReset}
        disabled={disabled}
        importStatus={importStatus}
        noticeMessage={noticeMessage}
        failureMessage={failureMessage}
        previewSummary={previewSummary}
        commitSummary={commitSummary}
        onContinueWithValidRows={onContinueWithValidRows}
        onCancelImport={onCancelImport}
        onUndoLastImport={onUndoLastImport}
        onImportComplete={handleCommitSummaryAcknowledge}
      />

      <details
        className={styles.historySection}
        open={historyOpen}
        onToggle={(e) => setHistoryOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className={styles.historySummary}>Import History</summary>

        {loadState === 'loading' && <p className={styles.msg}>Loading…</p>}
        {loadState === 'error' && <p className={styles.errorMsg}>{errorMsg}</p>}
        {loadState === 'loaded' && runs.length === 0 && (
          <p className={styles.msg}>No import runs yet.</p>
        )}
        {loadState === 'loaded' && runs.length > 0 && (
          <div className={styles.list}>
            {runs.map((item) => (
              <ImportRunDetail key={item.run.id} item={item} />
            ))}
          </div>
        )}
      </details>

      <div className={styles.devZone}>
        <h3 className={styles.devHeading}>Developer Tools</h3>
        <DevResetButton onReset={loadRuns} />
      </div>
    </div>
  );
}
