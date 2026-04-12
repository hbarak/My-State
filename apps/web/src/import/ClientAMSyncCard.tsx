import { useCallback, useState } from 'react';
import type { IBSyncSummary } from '../../../../packages/domain/src/services/IBApiSyncService';
import type { Account } from '../../../../packages/domain/src/types/account';
import { domain, IB_PROVIDER_ID, IB_API_INTEGRATION_ID, ibSessionStore, priceFetcher, setClientAMCookies } from '../domain/bootstrap';
import { SyncProgressStepper, type StepStatus } from './SyncProgressStepper';
import styles from './ApiSyncCard.module.css';

type SyncPhase =
  | 'idle'
  | 'paste_cookies'
  | 'checking'
  | 'fetching'
  | 'complete'
  | 'error';

interface ClientAMSyncCardProps {
  readonly disabled: boolean;
  readonly onAccountsChanged: () => void;
  readonly onClose?: () => void;
}

export function ClientAMSyncCard({ disabled, onAccountsChanged, onClose }: ClientAMSyncCardProps): JSX.Element {
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [cookieInput, setCookieInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<IBSyncSummary | null>(null);
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [newAccountCount, setNewAccountCount] = useState(0);

  const handleStartSync = useCallback(() => {
    setPhase('paste_cookies');
    setErrorMessage(null);
    setSyncSummary(null);
  }, []);

  const handleValidateAndSync = useCallback(async () => {
    const trimmed = cookieInput.trim();
    if (!trimmed) {
      setErrorMessage('Please paste your ClientAM cookies.');
      return;
    }

    setClientAMCookies(trimmed);
    setPhase('checking');
    setErrorMessage(null);

    try {
      const sessionCheck = await domain.clientamApiClient.checkSession();
      if (!sessionCheck.authenticated) {
        setErrorMessage('Session cookies are invalid or expired. Log into clientam.com and copy fresh cookies.');
        setPhase('error');
        return;
      }

      setPhase('fetching');

      const clientamAccounts = await domain.clientamApiClient.fetchAccounts();
      const discovery = await domain.accountService.discoverAccounts({
        providerId: IB_PROVIDER_ID,
        apiAccounts: clientamAccounts.map((a) => ({ key: a.id, name: a.desc ?? a.id, nickname: a.id })),
      });

      const accountPositions: Array<{ accountId: string; positions: Awaited<ReturnType<typeof domain.clientamApiClient.fetchPositions>> }> = [];
      for (const acct of clientamAccounts) {
        const positions = await domain.clientamApiClient.fetchPositions(acct.id);
        accountPositions.push({ accountId: acct.id, positions });
      }

      const summary = await domain.ibApiSyncService.syncAllAccounts({
        accountPositions,
        providerId: IB_PROVIDER_ID,
        providerIntegrationId: IB_API_INTEGRATION_ID,
      });

      // Build conid maps for session store + price routing
      const allPositions = accountPositions.flatMap((ap) => ap.positions);
      const conidToTicker = new Map(allPositions.map((p) => [String(p.conid), p.ticker ?? String(p.conid)]));
      const conidToDesc = new Map(allPositions.map((p) => [String(p.conid), p.contractDesc]));
      ibSessionStore.setConidMaps(conidToTicker, conidToDesc);
      ibSessionStore.setAuthenticated(true);

      // Update price routing
      priceFetcher.updateKnownTickers('ib', ibSessionStore.getKnownConids());

      const updatedAccounts = await domain.accountService.listByProvider(IB_PROVIDER_ID);
      setSyncSummary(summary);
      setAccounts(updatedAccounts);
      setNewAccountCount(discovery.created.length);
      setPhase('complete');
      onAccountsChanged();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMessage(message);
      setPhase('error');
    }
  }, [cookieInput, onAccountsChanged]);

  const handleTryAgain = useCallback(() => {
    setPhase('paste_cookies');
    setErrorMessage(null);
    setSyncSummary(null);
  }, []);

  const steps = buildSteps(phase);

  return (
    <div className={styles.syncCard}>
      <h3 className={styles.heading}>ClientAM (IB Israel) Sync</h3>
      <p className={styles.subtitle}>Import holdings from your IB account via ClientAM portal cookies</p>

      {phase === 'idle' && (
        <button
          type="button"
          className={styles.syncButton}
          onClick={handleStartSync}
          disabled={disabled}
        >
          Sync via ClientAM
        </button>
      )}

      {phase === 'paste_cookies' && (
        <>
          <div className={styles.cookieInstructions}>
            <p><strong>How to get cookies:</strong></p>
            <ol>
              <li>Open <strong>clientam.com</strong> and log in</li>
              <li>Press <strong>F12</strong> (DevTools) &rarr; <strong>Network</strong> tab</li>
              <li>Click any <code>portal.proxy</code> request</li>
              <li>Copy the full <strong>Cookie</strong> header value</li>
            </ol>
          </div>
          <textarea
            className={styles.cookieTextarea}
            placeholder="Paste your Cookie header value here..."
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            rows={4}
          />
          <button
            type="button"
            className={styles.syncButton}
            onClick={() => void handleValidateAndSync()}
            disabled={disabled || cookieInput.trim().length === 0}
          >
            Validate &amp; Sync
          </button>
        </>
      )}

      {(phase === 'checking' || phase === 'fetching') && (
        <SyncProgressStepper steps={steps} />
      )}

      {phase === 'error' && (
        <>
          <SyncProgressStepper steps={steps} />
          <div className={styles.errorBox} role="alert">
            <p>{errorMessage}</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={handleTryAgain}>
            Try Again
          </button>
        </>
      )}

      {phase === 'complete' && syncSummary && (
        <>
          <ClientAMSyncResults
            summary={syncSummary}
            accounts={accounts}
            newAccountCount={newAccountCount}
            onSyncAgain={handleTryAgain}
          />
          {onClose && (
            <button type="button" className={styles.secondaryButton} onClick={onClose}>
              Close
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ClientAMSyncResults({
  summary,
  accounts,
  newAccountCount,
  onSyncAgain,
}: {
  readonly summary: IBSyncSummary;
  readonly accounts: readonly Account[];
  readonly newAccountCount: number;
  readonly onSyncAgain: () => void;
}): JSX.Element {
  const timeStr = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

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
          {newAccountCount} new account{newAccountCount !== 1 ? 's' : ''} discovered.
        </p>
      )}

      {summary.accountsSynced > 0 && (
        <ul className={styles.accountList}>
          {summary.importRuns.map((run) => {
            const account = accounts.find((a) => a.id === run.accountId);
            const name = account?.name ?? run.accountId;
            return (
              <li key={run.id}>
                {run.accountId}{name !== run.accountId ? ` "${name}"` : ''} — {run.importedCount} position{run.importedCount !== 1 ? 's' : ''}
              </li>
            );
          })}
        </ul>
      )}

      {summary.errors.length > 0 && (
        <div className={styles.errorBox}>
          <p>
            {summary.accountsSynced} of {summary.accountsSynced + summary.errors.length} accounts synced.
          </p>
          <ul className={styles.accountList}>
            {summary.errors.map((e) => (
              <li key={e.accountId}>{e.accountId}: {e.error.message}</li>
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

function buildSteps(phase: SyncPhase): Array<{ label: string; status: StepStatus }> {
  const phaseOrder: SyncPhase[] = ['checking', 'fetching', 'complete'];
  const labels = ['Validating cookies...', 'Fetching positions...', 'Done'];

  const currentIdx = phaseOrder.indexOf(
    phase === 'error' ? 'checking'
      : phase === 'paste_cookies' ? 'checking'
      : phase,
  );

  return labels.map((label, i) => {
    let status: StepStatus = 'pending';
    if (phase === 'error') {
      if (i < currentIdx) status = 'complete';
      else if (i === currentIdx) status = 'failed';
    } else if (phase === 'complete') {
      status = 'complete';
    } else if (i < currentIdx) {
      status = 'complete';
    } else if (i === currentIdx) {
      status = 'active';
    }
    return { label, status };
  });
}
