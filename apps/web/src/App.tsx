import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  SPRINT1_HOLDINGS_INTEGRATION_ID,
  SPRINT1_PROVIDER_ID,
  SPRINT1_TRADES_INTEGRATION_ID,
  domain,
  ensureSprintOnePreviewSetup,
} from './domain/bootstrap';
import { parseCsvFileForHandoff, type UploadedCsvPayload } from './import/csvUpload';
import {
  saveResolutionAuditRecord,
  type ResolutionAction,
  type ResolutionRowOutcome,
} from './import/resolutionAuditStore';
import { PortfolioDashboard } from './portfolio';
import { AddDataWizard } from './import/AddDataWizard';
import type { PreviewSummary, CommitSummary } from './import/AddDataWizard';
import { DataTab } from './data/DataTab';
import type { Account } from '../../../packages/domain/src/types/account';
import styles from './App.module.css';

type PreviewResult = Awaited<ReturnType<typeof domain.importService.previewImport>>;
type PreviewRow = PreviewResult['validRows'][number];
type CommitResult = Awaited<ReturnType<typeof domain.importService.commitImport>>;
type HoldingsState = Awaited<ReturnType<typeof domain.financialStateService.getTotalHoldingsState>>;

type ActiveView = 'portfolio' | 'data';
type BootstrapStatus = 'loading' | 'ready' | 'error';
type ImportStatus = 'idle' | 'processing' | 'awaiting_error_action' | 'completed' | 'failed' | 'cancelled';

interface ReasonSummary {
  code: string;
  count: number;
  message?: string;
}

export default function App(): JSX.Element {
  const [activeView, setActiveView] = useState<ActiveView>('portfolio');
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus>('loading');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [uploaded, setUploaded] = useState<UploadedCsvPayload | null>(null);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [holdingsState, setHoldingsState] = useState<HoldingsState | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [clientRunId, setClientRunId] = useState<string>(() => makeClientRunId());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const activeRunToken = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void ensureSprintOnePreviewSetup()
      .then(async () => {
        if (cancelled) return;
        const accountList = await domain.accountService.listByProvider(SPRINT1_PROVIDER_ID);
        if (cancelled) return;
        setAccounts(accountList);
        if (accountList.length > 0 && !selectedAccountId) {
          setSelectedAccountId(accountList[0].id);
        }
        setBootstrapStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setBootstrapStatus('error');
        setBootstrapError(toErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const invalidCount = preview?.invalidRows.length ?? 0;
  const duplicateCount = preview?.duplicateRows.length ?? 0;
  const reasonSummary = useMemo(() => summarizeReasons(preview?.invalidRows ?? []), [preview]);

  const onRenameAccount = async (accountId: string, name: string): Promise<void> => {
    await domain.accountService.updateAccount(SPRINT1_PROVIDER_ID, accountId, { name });
    const updated = await domain.accountService.listByProvider(SPRINT1_PROVIDER_ID);
    setAccounts(updated);
  };

  const onAccountsChanged = async (): Promise<void> => {
    const updated = await domain.accountService.listByProvider(SPRINT1_PROVIDER_ID);
    setAccounts(updated);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    void beginUpload(file);
  };

  const beginUpload = async (file: File): Promise<void> => {
    const token = ++activeRunToken.current;
    resetRunState();
    setStatus('processing');
    setNoticeMessage(`Processing ${file.name}...`);

    try {
      const parsed = await parseCsvFileForHandoff(file);
      if (!isActiveToken(token, activeRunToken.current)) return;

      const integrationId = await selectIntegrationIdForUpload(parsed);
      if (!isActiveToken(token, activeRunToken.current)) return;

      const runId = makeClientRunId();
      setClientRunId(runId);
      setUploaded(parsed);
      setSelectedIntegrationId(integrationId);

      const previewResult = await domain.importService.previewImport({
        providerId: SPRINT1_PROVIDER_ID,
        providerIntegrationId: integrationId,
        csvText: parsed.csvText,
        accountId: selectedAccountId ?? undefined,
      });
      if (!isActiveToken(token, activeRunToken.current)) return;

      setPreview(previewResult);

      if (previewResult.invalidRows.length > 0) {
        setStatus('awaiting_error_action');
        setNoticeMessage(
          `${previewResult.invalidRows.length} invalid row(s) need a decision before commit.`,
        );
        return;
      }

      await commitAndRefresh({
        token,
        payload: parsed,
        integrationId,
      });
    } catch (error) {
      if (!isActiveToken(token, activeRunToken.current)) return;
      setStatus('failed');
      setFailureMessage(toErrorMessage(error));
      setNoticeMessage(null);
    }
  };

  const onContinueWithValidRows = async (): Promise<void> => {
    if (!uploaded || !selectedIntegrationId || !preview) return;
    const token = activeRunToken.current;
    setStatus('processing');
    setFailureMessage(null);
    setNoticeMessage('Committing valid rows and skipping invalid rows...');

    persistResolutionDecision({
      action: 'skip_batch',
      runId: clientRunId,
      uploaded,
      integrationId: selectedIntegrationId,
      invalidRows: preview.invalidRows,
    });

    try {
      await commitAndRefresh({
        token,
        payload: uploaded,
        integrationId: selectedIntegrationId,
      });
    } catch (error) {
      if (!isActiveToken(token, activeRunToken.current)) return;
      setStatus('failed');
      setFailureMessage(toErrorMessage(error));
      setNoticeMessage(null);
    }
  };

  const onCancelImport = (): void => {
    if (!uploaded || !selectedIntegrationId || !preview) return;

    persistResolutionDecision({
      action: 'cancel_import',
      runId: clientRunId,
      uploaded,
      integrationId: selectedIntegrationId,
      invalidRows: preview.invalidRows,
    });

    setStatus('cancelled');
    setFailureMessage(null);
    setNoticeMessage('Import canceled. No rows were committed.');
  };

  const onUndoLastImport = async (): Promise<void> => {
    if (!selectedIntegrationId) return;
    setStatus('processing');
    setFailureMessage(null);
    setNoticeMessage('Undoing last import...');

    try {
      const undone = await domain.importService.undoLastImport(selectedIntegrationId);
      if (!undone) {
        setStatus('completed');
        setNoticeMessage('No undoable import found.');
        return;
      }

      const holdings = await domain.financialStateService.getTotalHoldingsState({
        providerId: SPRINT1_PROVIDER_ID,
      });

      setHoldingsState(holdings);
      setCommitResult((previous) => (previous ? { ...previous, importRun: undone } : previous));
      setStatus('completed');
      setNoticeMessage(`Undid import run ${undone.id}.`);
    } catch (error) {
      setStatus('failed');
      setFailureMessage(toErrorMessage(error));
      setNoticeMessage(null);
    }
  };

  async function commitAndRefresh(params: {
    token: number;
    payload: UploadedCsvPayload;
    integrationId: string;
  }): Promise<void> {
    const result = await domain.importService.commitImport({
      providerId: SPRINT1_PROVIDER_ID,
      providerIntegrationId: params.integrationId,
      sourceName: params.payload.sourceName,
      csvText: params.payload.csvText,
      accountId: selectedAccountId ?? undefined,
    });
    if (!isActiveToken(params.token, activeRunToken.current)) return;

    const holdings = await domain.financialStateService.getTotalHoldingsState({
      providerId: SPRINT1_PROVIDER_ID,
    });
    if (!isActiveToken(params.token, activeRunToken.current)) return;

    setCommitResult(result);
    setHoldingsState(holdings);
    setStatus('completed');
    setFailureMessage(null);
    setNoticeMessage(`Import completed for ${params.payload.sourceName}.`);
  }

  function resetRunState(): void {
    setFailureMessage(null);
    setNoticeMessage(null);
    setStatus('idle');
    setUploaded(null);
    setSelectedIntegrationId(null);
    setPreview(null);
    setCommitResult(null);
    setHoldingsState(null);
  }

  const isBusy = status === 'processing';
  const canUpload = bootstrapStatus === 'ready' && !isBusy;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.logo}>my-stocks</span>
        <nav className={styles.tabs}>
          <button
            className={activeView === 'portfolio' ? styles.tabActive : styles.tab}
            onClick={() => setActiveView('portfolio')}
          >
            Portfolio
          </button>
          <button
            className={activeView === 'data' ? styles.tabActive : styles.tab}
            onClick={() => setActiveView('data')}
          >
            Data
          </button>
        </nav>
        <div className={styles.headerActions} />
      </header>

      {activeView === 'portfolio' && bootstrapStatus === 'ready' && <PortfolioDashboard />}
      {activeView === 'portfolio' && bootstrapStatus === 'loading' && <p>Preparing...</p>}
      {activeView === 'portfolio' && bootstrapStatus === 'error' && (
        <p className={styles.error}>Setup failed: {bootstrapError}</p>
      )}

      {activeView === 'data' && (
        <DataTab
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          onSelectAccount={setSelectedAccountId}
          onRenameAccount={onRenameAccount}
          onAccountsChanged={() => void onAccountsChanged()}
          onFileSelected={(file) => {
            const syntheticEvent = { target: { files: [file], value: '' } } as unknown as ChangeEvent<HTMLInputElement>;
            onFileChange(syntheticEvent);
          }}
          onReset={resetRunState}
          disabled={!canUpload}
          importStatus={status}
          noticeMessage={noticeMessage}
          failureMessage={failureMessage}
          previewSummary={preview ? buildPreviewSummary(preview, reasonSummary) : null}
          commitSummary={commitResult ? buildCommitSummary(commitResult) : null}
          onContinueWithValidRows={() => void onContinueWithValidRows()}
          onCancelImport={onCancelImport}
          onUndoLastImport={() => void onUndoLastImport()}
          onNavigateToPortfolio={() => setActiveView('portfolio')}
        />
      )}
    </main>
  );
}

async function selectIntegrationIdForUpload(uploaded: UploadedCsvPayload): Promise<string> {
  const [tradesProfile, holdingsProfile] = await Promise.all([
    domain.repository.getActiveMappingProfile(SPRINT1_TRADES_INTEGRATION_ID),
    domain.repository.getActiveMappingProfile(SPRINT1_HOLDINGS_INTEGRATION_ID),
  ]);

  const tradesScore = scoreRequiredHeaderMatch(uploaded.headers, tradesProfile);
  const holdingsScore = scoreRequiredHeaderMatch(uploaded.headers, holdingsProfile);
  return holdingsScore > tradesScore ? SPRINT1_HOLDINGS_INTEGRATION_ID : SPRINT1_TRADES_INTEGRATION_ID;
}

function scoreRequiredHeaderMatch(
  headers: string[],
  profile: Awaited<ReturnType<typeof domain.repository.getActiveMappingProfile>>,
): number {
  if (!profile) return 0;

  const present = new Set(headers.map((header) => header.trim()));
  const requiredHeaders = (profile.requiredCanonicalFields ?? [])
    .map((field) => profile.fieldMappings[field])
    .filter((header): header is string => Boolean(header && header.trim()))
    .map((header) => header.trim());

  if (requiredHeaders.length === 0) return 0;
  const matched = requiredHeaders.filter((header) => present.has(header)).length;
  return matched / requiredHeaders.length;
}

function summarizeReasons(rows: PreviewRow[]): ReasonSummary[] {
  const counts = new Map<string, ReasonSummary>();

  for (const row of rows) {
    const code = row.errorCode ?? 'INVALID_ROW';
    const existing = counts.get(code);
    if (existing) {
      counts.set(code, {
        ...existing,
        count: existing.count + 1,
        message: existing.message ?? row.errorMessage,
      });
      continue;
    }

    counts.set(code, {
      code,
      count: 1,
      message: row.errorMessage,
    });
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count);
}

function persistResolutionDecision(params: {
  action: Extract<ResolutionAction, 'skip_batch' | 'cancel_import'>;
  runId: string;
  uploaded: UploadedCsvPayload;
  integrationId: string;
  invalidRows: PreviewRow[];
}): void {
  if (params.invalidRows.length === 0) return;

  const resolution: ResolutionRowOutcome = params.action === 'skip_batch' ? 'skip' : 'cancel_pending';
  const note =
    params.action === 'skip_batch'
      ? 'User approved commit with invalid rows skipped.'
      : 'User canceled import due to invalid rows.';

  try {
    saveResolutionAuditRecord({
      clientRunId: params.runId,
      providerId: SPRINT1_PROVIDER_ID,
      providerIntegrationId: params.integrationId,
      sourceName: params.uploaded.sourceName,
      csvText: params.uploaded.csvText,
      runDecision: {
        action: params.action,
        note,
        blockedRowCount: params.invalidRows.length,
      },
      rowTags: params.invalidRows.map((row) => ({
        rowNumber: row.rowNumber,
        reasonCode: row.errorCode ?? 'INVALID_ROW',
        resolution,
        note: row.errorMessage,
      })),
    });
  } catch (error) {
    console.warn('Failed to save resolution audit record', error);
  }
}

function isActiveToken(token: number, currentToken: number): boolean {
  return token === currentToken;
}

function makeClientRunId(): string {
  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown import error';
}

function buildPreviewSummary(
  preview: PreviewResult,
  reasonSummary: ReasonSummary[],
): import('./import/AddDataWizard').PreviewSummary {
  return {
    validCount: preview.validRows.length,
    invalidCount: preview.invalidRows.length,
    duplicateCount: preview.duplicateRows.length,
    reasonSummary,
    invalidRows: preview.invalidRows.map((row) => ({
      rowNumber: row.rowNumber,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    })),
    duplicateRows: preview.duplicateRows.map((row) => ({
      rowNumber: row.rowNumber,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    })),
  };
}

function buildCommitSummary(result: CommitResult): import('./import/AddDataWizard').CommitSummary {
  return {
    importedTrades: result.importedTrades,
    skippedRows: result.skippedRows,
    errorRows: result.errorRows,
  };
}
