import { ChangeEvent, DragEvent, useRef, useState } from 'react';
import type { Account } from '../../../../packages/domain/src/types/account';
import { AccountSelector } from './AccountSelector';
import { ApiSyncCard } from './ApiSyncCard';
import styles from './AddDataWizard.module.css';

type Source = 'csv' | 'api';

interface AddDataWizardProps {
  // Account state
  readonly accounts: readonly Account[];
  readonly selectedAccountId: string | null;
  readonly onSelectAccount: (accountId: string) => void;
  readonly onCreateAccount: (params: { id: string; name: string }) => Promise<void>;
  readonly onRenameAccount: (accountId: string, name: string) => Promise<void>;
  readonly onAccountsChanged: () => void;

  // CSV upload
  readonly onFileSelected: (file: File) => void;
  readonly disabled: boolean;
  readonly onReset: () => void;

  // Import state — shown in preview/done steps
  readonly importStatus: ImportStatus;
  readonly noticeMessage: string | null;
  readonly failureMessage: string | null;
  readonly previewSummary: PreviewSummary | null;
  readonly commitSummary: CommitSummary | null;
  readonly onContinueWithValidRows: () => void;
  readonly onCancelImport: () => void;
  readonly onUndoLastImport: () => void;
}

export type ImportStatus = 'idle' | 'processing' | 'awaiting_error_action' | 'completed' | 'failed' | 'cancelled';

export interface PreviewSummary {
  readonly validCount: number;
  readonly invalidCount: number;
  readonly duplicateCount: number;
  readonly reasonSummary: readonly { code: string; count: number; message?: string }[];
  readonly invalidRows: readonly { rowNumber: number; errorCode?: string; errorMessage?: string }[];
  readonly duplicateRows: readonly { rowNumber: number; errorCode?: string; errorMessage?: string }[];
}

export interface CommitSummary {
  readonly importedTrades: number;
  readonly skippedRows: number;
  readonly errorRows: number;
}

type WizardStep = 'choose' | 'configure' | 'preview' | 'done';

function deriveStep(source: Source | null, importStatus: ImportStatus): WizardStep {
  if (!source) return 'choose';
  if (importStatus === 'completed' || importStatus === 'cancelled') return 'done';
  if (importStatus === 'awaiting_error_action') return 'preview';
  if (importStatus === 'processing' || importStatus === 'failed') return 'preview';
  return 'configure';
}

export function AddDataWizard({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onCreateAccount,
  onRenameAccount,
  onAccountsChanged,
  onFileSelected,
  disabled,
  importStatus,
  noticeMessage,
  failureMessage,
  previewSummary,
  commitSummary,
  onContinueWithValidRows,
  onCancelImport,
  onUndoLastImport,
  onReset,
}: AddDataWizardProps): JSX.Element {
  const [source, setSource] = useState<Source | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const currentStep = deriveStep(source, importStatus);
  const isBusy = importStatus === 'processing';

  const handleChooseSource = (chosen: Source): void => {
    setSource(chosen);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    onFileSelected(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFileSelected(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (): void => {
    setIsDragging(false);
  };

  const handleStartOver = (): void => {
    setSource(null);
    onReset();
  };

  return (
    <div className={styles.wizard}>
      <StepIndicator currentStep={currentStep} source={source} />

      {/* Step 1: Choose source */}
      {currentStep === 'choose' && (
        <div className={styles.step}>
          <h2 className={styles.stepTitle}>Add Data</h2>
          <p className={styles.stepSubtitle}>Choose how you want to import your portfolio data.</p>
          <div className={styles.sourceGrid}>
            <button
              type="button"
              className={styles.sourceCard}
              onClick={() => handleChooseSource('csv')}
              disabled={disabled}
            >
              <span className={styles.sourceIcon} aria-hidden="true">📄</span>
              <span className={styles.sourceLabel}>CSV Upload</span>
              <span className={styles.sourceDesc}>Import from Psagot CSV export</span>
            </button>
            <button
              type="button"
              className={styles.sourceCard}
              onClick={() => handleChooseSource('api')}
              disabled={disabled}
            >
              <span className={styles.sourceIcon} aria-hidden="true">🔄</span>
              <span className={styles.sourceLabel}>API Sync</span>
              <span className={styles.sourceDesc}>Live sync via Psagot API (OTP required)</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 2 CSV: Account + file drop */}
      {currentStep === 'configure' && source === 'csv' && (
        <div className={styles.step}>
          <h2 className={styles.stepTitle}>CSV Upload</h2>

          <div className={styles.fieldGroup}>
            <AccountSelector
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onSelect={onSelectAccount}
              onCreate={onCreateAccount}
              onRename={onRenameAccount}
              disabled={isBusy}
            />
          </div>

          <div
            className={`${styles.dropZone} ${isDragging ? styles.dragging : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            role="button"
            tabIndex={0}
            aria-label="Drop CSV file here or click to browse"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          >
            <span className={styles.dropIcon} aria-hidden="true">📂</span>
            <span className={styles.dropLabel}>Drag &amp; drop your CSV here</span>
            <span className={styles.dropOr}>or</span>
            <span className={styles.dropBrowse}>Browse file</span>
            <input
              ref={fileInputRef}
              id="csv-upload"
              type="file"
              accept=".csv,text/csv"
              className={styles.hiddenInput}
              onChange={handleFileChange}
              disabled={isBusy || disabled}
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>

          <button type="button" className={styles.backLink} onClick={handleStartOver}>
            ← Back
          </button>
        </div>
      )}

      {/* Step 2 API: ApiSyncCard */}
      {currentStep === 'configure' && source === 'api' && (
        <div className={styles.step}>
          <h2 className={styles.stepTitle}>API Sync</h2>
          <ApiSyncCard disabled={isBusy} onAccountsChanged={onAccountsChanged} />
          <button type="button" className={styles.backLink} onClick={handleStartOver}>
            ← Back
          </button>
        </div>
      )}

      {/* Step 3: Preview / processing */}
      {currentStep === 'preview' && (
        <div className={styles.step}>
          <h2 className={styles.stepTitle}>Preview</h2>

          {importStatus === 'processing' && (
            <p className={styles.notice}>{noticeMessage ?? 'Processing…'}</p>
          )}

          {importStatus === 'failed' && failureMessage && (
            <p className={styles.error}>{failureMessage}</p>
          )}

          {importStatus === 'awaiting_error_action' && previewSummary && (
            <>
              <div className={styles.previewCounts}>
                <span className={styles.countBadge} data-type="valid">{previewSummary.validCount} valid</span>
                {previewSummary.duplicateCount > 0 && (
                  <span className={styles.countBadge} data-type="duplicate">{previewSummary.duplicateCount} duplicate</span>
                )}
                <span className={styles.countBadge} data-type="invalid">{previewSummary.invalidCount} invalid</span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={onContinueWithValidRows}
                  disabled={isBusy}
                >
                  Import {previewSummary.validCount} valid rows
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={onCancelImport}
                  disabled={isBusy}
                >
                  Cancel
                </button>
              </div>

              {previewSummary.invalidCount > 0 && (
                <details className={styles.details}>
                  <summary>Show invalid rows ({previewSummary.invalidCount})</summary>
                  <ul className={styles.rowList}>
                    {previewSummary.invalidRows.slice(0, 12).map((row) => (
                      <li key={`invalid-${row.rowNumber}`}>
                        Row {row.rowNumber}: {row.errorMessage ?? row.errorCode ?? 'Invalid row'}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* Step 4: Done */}
      {currentStep === 'done' && (
        <div className={styles.step}>
          {importStatus === 'completed' && commitSummary && (
            <>
              <div className={styles.doneBanner}>
                <span className={styles.doneIcon} aria-hidden="true">✓</span>
                <span className={styles.doneTitle}>Import complete</span>
              </div>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryBox}>
                  <p className={styles.summaryLabel}>Imported</p>
                  <p className={styles.summaryValue}>{commitSummary.importedTrades}</p>
                </div>
                <div className={styles.summaryBox}>
                  <p className={styles.summaryLabel}>Skipped</p>
                  <p className={styles.summaryValue}>{commitSummary.skippedRows}</p>
                </div>
                <div className={styles.summaryBox}>
                  <p className={styles.summaryLabel}>Errors</p>
                  <p className={styles.summaryValue}>{commitSummary.errorRows}</p>
                </div>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.primaryButton} onClick={handleStartOver}>
                  Import another
                </button>
                <button type="button" className={styles.secondaryButton} onClick={onUndoLastImport} disabled={isBusy}>
                  Undo
                </button>
              </div>
            </>
          )}
          {importStatus === 'cancelled' && (
            <>
              <p className={styles.notice}>Import cancelled — no rows were committed.</p>
              <button type="button" className={styles.secondaryButton} onClick={handleStartOver}>
                Start over
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StepIndicator({ currentStep, source }: { currentStep: WizardStep; source: Source | null }): JSX.Element {
  const steps: { key: WizardStep; label: string }[] = [
    { key: 'choose', label: 'Source' },
    { key: 'configure', label: source === 'api' ? 'Sync' : 'Upload' },
    { key: 'preview', label: 'Preview' },
    { key: 'done', label: 'Done' },
  ];
  const ORDER: WizardStep[] = ['choose', 'configure', 'preview', 'done'];
  const currentIndex = ORDER.indexOf(currentStep);

  return (
    <div className={styles.stepIndicator} aria-label="Import progress">
      {steps.map((step, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <div key={step.key} className={styles.stepItem}>
            <div
              className={`${styles.stepDot} ${isDone ? styles.stepDone : ''} ${isCurrent ? styles.stepCurrent : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isDone ? '✓' : index + 1}
            </div>
            <span className={`${styles.stepLabel} ${isCurrent ? styles.stepLabelActive : ''}`}>
              {step.label}
            </span>
            {index < steps.length - 1 && <div className={`${styles.stepLine} ${isDone ? styles.stepLineDone : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}
