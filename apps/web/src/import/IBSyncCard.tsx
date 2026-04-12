import { useCallback, useEffect, useRef, useState } from 'react';
import type { IBSyncSummary } from '../../../../packages/domain/src/services/IBApiSyncService';
import type { IBAuthStatus } from '../../../../packages/domain/src/types/ibApi';
import type { Account } from '../../../../packages/domain/src/types/account';
import { domain, IB_PROVIDER_ID, IB_API_INTEGRATION_ID, ibSessionStore, priceFetcher } from '../domain/bootstrap';
import { SyncProgressStepper, type StepStatus } from './SyncProgressStepper';
import styles from './ApiSyncCard.module.css';

const TICKLE_INTERVAL_MS = 55_000;

type SyncPhase =
  | 'idle'
  | 'checking'
  | 'not_connected'
  | 'fetching'
  | 'complete'
  | 'error';

interface IBSyncCardProps {
  readonly disabled: boolean;
  readonly onAccountsChanged: () => void;
  readonly onClose?: () => void;
}

export function IBSyncCard({ disabled, onAccountsChanged, onClose }: IBSyncCardProps): JSX.Element {
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [authStatus, setAuthStatus] = useState<IBAuthStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<IBSyncSummary | null>(null);
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [newAccountCount, setNewAccountCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const tickleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop tickle interval on unmount or session loss
  const stopTickle = useCallback(() => {
    if (tickleIntervalRef.current) {
      clearInterval(tickleIntervalRef.current);
      tickleIntervalRef.current = null;
    }
  }, []);

  const startTickle = useCallback(() => {
    stopTickle();
    tickleIntervalRef.current = setInterval(() => {
      domain.ibApiClient.tickle()
        .then(() => { ibSessionStore.recordTickle(); })
        .catch(() => {
          ibSessionStore.clearSession();
          stopTickle();
        });
    }, TICKLE_INTERVAL_MS);
  }, [stopTickle]);

  useEffect(() => {
    return () => stopTickle();
  }, [stopTickle]);

  const handleStartSync = useCallback(async () => {
    setPhase('checking');
    setErrorMessage(null);
    setSyncSummary(null);

    try {
      const status = await domain.ibApiClient.checkAuthStatus();
      setAuthStatus(status);

      if (!status.authenticated) {
        setPhase('not_connected');
        return;
      }

      if (status.competing) {
        setPhase('not_connected');
        setErrorMessage('A competing session (e.g. TWS) is active. Close it and try again.');
        return;
      }

      ibSessionStore.setAuthenticated(true);
      setPhase('fetching');

      // Fetch accounts
      const ibAccounts = await domain.ibApiClient.fetchAccounts();
      const discovery = await domain.accountService.discoverAccounts({
        providerId: IB_PROVIDER_ID,
        apiAccounts: ibAccounts.map((a) => ({ key: a.id, name: a.desc ?? a.id, nickname: a.id })),
      });

      // Fetch positions for all accounts
      const accountPositions: Array<{ accountId: string; positions: Awaited<ReturnType<typeof domain.ibApiClient.fetchPositions>> }> = [];
      for (const acct of ibAccounts) {
        const positions = await domain.ibApiClient.fetchPositions(acct.id);
        accountPositions.push({ accountId: acct.id, positions });
      }

      // Sync to domain
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

      // Update price routing
      priceFetcher.updateKnownTickers('ib', ibSessionStore.getKnownConids());

      // Start keepalive
      startTickle();

      const updatedAccounts = await domain.accountService.listByProvider(IB_PROVIDER_ID);
      setSyncSummary(summary);
      setAccounts(updatedAccounts);
      setNewAccountCount(discovery.created.length);
      setLastSyncedAt(new Date());
      setPhase('complete');
      onAccountsChanged();
    } catch (err) {
      ibSessionStore.clearSession();
      stopTickle();
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setErrorMessage(message);
      setPhase('error');
    }
  }, [onAccountsChanged, startTickle, stopTickle]);

  const handleSyncAgain = useCallback(() => {
    setPhase('idle');
    setSyncSummary(null);
    setErrorMessage(null);
    setAuthStatus(null);
  }, []);

  const steps = buildSteps(phase);

  return (
    <div className={styles.syncCard}>
      <h3 className={styles.heading}>Interactive Brokers Sync</h3>
      <p className={styles.subtitle}>Import live holdings from your IB account via the local gateway</p>

      {phase === 'idle' && (
        <>
          <button
            type="button"
            className={styles.syncButton}
            onClick={() => void handleStartSync()}
            disabled={disabled}
          >
            Connect &amp; Sync
          </button>
          {lastSyncedAt && (
            <p className={styles.lastSynced}>
              Last synced {formatRelativeTime(lastSyncedAt)}
            </p>
          )}
        </>
      )}

      {(phase === 'checking' || phase === 'fetching') && (
        <SyncProgressStepper steps={steps} />
      )}

      {phase === 'not_connected' && (
        <>
          <div className={styles.errorBox} role="alert">
            <p>
              {errorMessage ?? 'IB Gateway is not authenticated. Please log in at '}
              {!errorMessage && (
                <strong>https://localhost:5000</strong>
              )}
              {!errorMessage && ' and try again.'}
            </p>
            {authStatus?.competing && (
              <p>Competing session detected. Close TWS or other active sessions first.</p>
            )}
          </div>
          <button type="button" className={styles.syncButton} onClick={() => void handleStartSync()}>
            Retry
          </button>
          <p className={styles.lastSynced}>
            Make sure the IB Client Portal Gateway is running (<code>docker run -p 5000:5000 ghcr.io/gnzsnz/ib-gateway:stable</code>) and you have logged in via the browser.
          </p>
        </>
      )}

      {phase === 'error' && (
        <>
          <SyncProgressStepper steps={steps} />
          <div className={styles.errorBox} role="alert">
            <p>{errorMessage}</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={handleSyncAgain}>
            Try Again
          </button>
        </>
      )}

      {phase === 'complete' && syncSummary && (
        <>
          <IBSyncResults
            summary={syncSummary}
            accounts={accounts}
            newAccountCount={newAccountCount}
            onSyncAgain={handleSyncAgain}
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

function IBSyncResults({
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
  const labels = ['Checking gateway...', 'Fetching positions...', 'Done'];

  const currentIdx = phaseOrder.indexOf(
    phase === 'error' ? 'checking'
      : phase === 'not_connected' ? 'checking'
      : phase,
  );

  return labels.map((label, i) => {
    let status: StepStatus = 'pending';
    if (phase === 'error' || phase === 'not_connected') {
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

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
