import { useCallback, useEffect, useRef, useState } from 'react';
import type { PsagotCredentials, PsagotPendingSession, PsagotApiError } from '../../../../packages/domain/src/types/psagotApi';
import type { ApiSyncSummary } from '../../../../packages/domain/src/services/PsagotApiSyncService';
import type { Account } from '../../../../packages/domain/src/types/account';
import { domain, PSAGOT_PROVIDER_ID, PSAGOT_API_INTEGRATION_ID, psagotSessionStore, priceFetcher } from '../domain/bootstrap';
import { CredentialsForm } from './CredentialsForm';
import { OtpModal } from './OtpModal';
import { SyncProgressStepper, type StepStatus } from './SyncProgressStepper';
import { SyncResultsSummary } from './SyncResultsSummary';
import styles from './ApiSyncCard.module.css';

const MAX_OTP_ATTEMPTS = 3;

function isPsagotApiError(err: unknown): err is PsagotApiError {
  return typeof err === 'object' && err !== null && 'type' in err;
}

type SyncPhase =
  | 'idle'
  | 'entering_credentials'
  | 'authenticating'
  | 'awaiting_otp'
  | 'verifying_otp'
  | 'fetching'
  | 'complete'
  | 'error';

interface ApiSyncCardProps {
  readonly disabled: boolean;
  readonly onAccountsChanged: () => void;
  readonly onClose?: () => void;
}

export function ApiSyncCard({ disabled, onAccountsChanged, onClose }: ApiSyncCardProps): JSX.Element {
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpAttempts, setOtpAttempts] = useState(0);
  const [syncSummary, setSyncSummary] = useState<ApiSyncSummary | null>(null);
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [newAccountCount, setNewAccountCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Held in refs so they never persist beyond the current flow
  const pendingSessionRef = useRef<PsagotPendingSession | null>(null);
  const credentialsRef = useRef<PsagotCredentials | null>(null);

  // Clear sensitive refs on unmount to avoid leaving credentials in memory
  useEffect(() => {
    return () => {
      pendingSessionRef.current = null;
      credentialsRef.current = null;
    };
  }, []);

  const handleStartSync = useCallback(() => {
    setPhase('entering_credentials');
    setErrorMessage(null);
    setOtpError(null);
    setSyncSummary(null);
    setOtpAttempts(0);
  }, []);

  const handleCredentialsSubmit = useCallback(async (credentials: PsagotCredentials) => {
    credentialsRef.current = credentials;
    setPhase('authenticating');
    setErrorMessage(null);

    try {
      const pending = await domain.psagotApiClient.initiateLogin(credentials);
      pendingSessionRef.current = pending;
      setPhase('awaiting_otp');
    } catch (err) {
      handleSyncError(err);
    }
  }, []);

  const handleOtpSubmit = useCallback(async (code: string) => {
    const pending = pendingSessionRef.current;
    const creds = credentialsRef.current;
    if (!pending || !creds) return;

    setPhase('verifying_otp');
    setOtpError(null);

    try {
      const session = await domain.psagotApiClient.verifyOtp(pending, code, creds);

      // Clear credentials immediately after successful auth
      credentialsRef.current = null;

      setPhase('fetching');

      // Discover accounts
      const apiAccounts = await domain.psagotApiClient.fetchAccounts(session);
      const discovery = await domain.accountService.discoverAccounts({
        providerId: PSAGOT_PROVIDER_ID,
        apiAccounts,
      });

      // Fetch balances sequentially — Psagot API enforces 1s minimum between requests
      const accountBalances: Array<{ accountId: string; balances: Awaited<ReturnType<typeof domain.psagotApiClient.fetchBalances>> }> = [];
      for (const acct of apiAccounts) {
        if (accountBalances.length > 0) {
          await new Promise((r) => setTimeout(r, 1100));
        }
        const balances = await domain.psagotApiClient.fetchBalances(session, acct.key);
        accountBalances.push({ accountId: acct.key, balances });
      }

      // Fetch security metadata for all equity numbers across all accounts (names, divider, ticker)
      const allEquityNumbers = [...new Set(accountBalances.flatMap((ab) => ab.balances.map((b) => b.equityNumber)))];
      const securityInfoList = await domain.psagotApiClient.fetchSecurityInfo(session, allEquityNumbers);
      const securityInfoMap = new Map(securityInfoList.map((info) => [info.equityNumber, info]));

      // Sync all
      const summary = await domain.psagotApiSyncService.syncAllAccounts({
        accountBalances,
        providerId: PSAGOT_PROVIDER_ID,
        providerIntegrationId: PSAGOT_API_INTEGRATION_ID,
        securityInfoMap,
      });

      // Refresh account list for parent
      const updatedAccounts = await domain.accountService.listByProvider(PSAGOT_PROVIDER_ID);

      // Cache session + metadata for price-only fetches
      psagotSessionStore.setSession(session);
      psagotSessionStore.setAccountKeys(apiAccounts.map((a) => a.key));
      psagotSessionStore.setSecurityInfoMap(securityInfoMap);

      // Update provider tickers so FanOutPriceFetcher routes through Psagot
      const providerEquityNumbers = new Set(allEquityNumbers);
      priceFetcher.updateKnownTickers('psagot-equity', providerEquityNumbers);

      setSyncSummary(summary);
      setAccounts(updatedAccounts);
      setNewAccountCount(discovery.created.length);
      setLastSyncedAt(new Date());
      setPhase('complete');
      onAccountsChanged();
    } catch (err) {
      if (isPsagotApiError(err)) {
        if (err.type === 'otp_invalid') {
          const nextAttempts = otpAttempts + 1;
          setOtpAttempts(nextAttempts);
          if (nextAttempts >= MAX_OTP_ATTEMPTS) {
            handleSyncError(new Error('Too many incorrect attempts. Please start over.'));
            return;
          }
          setOtpError(err.message);
          setPhase('awaiting_otp');
          return;
        }
        if (err.type === 'otp_expired') {
          setOtpError(err.message);
          setPhase('awaiting_otp');
          return;
        }
      }
      handleSyncError(err);
    }
  }, [onAccountsChanged, otpAttempts]);

  const handleOtpCancel = useCallback(() => {
    pendingSessionRef.current = null;
    credentialsRef.current = null;
    setPhase('idle');
    setOtpError(null);
    setOtpAttempts(0);
  }, []);

  const handleOtpResend = useCallback(async () => {
    const creds = credentialsRef.current;
    if (!creds) return;

    try {
      const pending = await domain.psagotApiClient.initiateLogin(creds);
      pendingSessionRef.current = pending;
      setOtpError(null);
    } catch (err) {
      handleSyncError(err);
    }
  }, []);

  const handleRetry = useCallback(() => {
    setPhase('entering_credentials');
    setErrorMessage(null);
    setOtpAttempts(0);
  }, []);

  const handleSyncAgain = useCallback(() => {
    setPhase('idle');
    setSyncSummary(null);
    setErrorMessage(null);
  }, []);

  function handleSyncError(err: unknown): void {
    pendingSessionRef.current = null;
    credentialsRef.current = null;
    const message = isPsagotApiError(err)
      ? err.message
      : err instanceof Error
        ? err.message
        : 'An unexpected error occurred.';
    setErrorMessage(message);
    setPhase('error');
  }

  // Build stepper steps
  const steps = buildSteps(phase);

  return (
    <div className={styles.syncCard}>
      <h3 className={styles.heading}>Psagot API Sync</h3>
      <p className={styles.subtitle}>Fetch live holdings from your Psagot accounts</p>

      {phase === 'idle' && (
        <>
          <button
            type="button"
            className={styles.syncButton}
            onClick={handleStartSync}
            disabled={disabled}
          >
            Sync Now
          </button>
          {lastSyncedAt && (
            <p className={styles.lastSynced}>
              Last synced {formatRelativeTime(lastSyncedAt)}
            </p>
          )}
        </>
      )}

      {phase === 'entering_credentials' && (
        <CredentialsForm onSubmit={(creds) => void handleCredentialsSubmit(creds)} />
      )}

      {(phase === 'authenticating' || phase === 'fetching') && (
        <SyncProgressStepper steps={steps} />
      )}

      {(phase === 'awaiting_otp' || phase === 'verifying_otp') && (
        <>
          <SyncProgressStepper steps={steps} />
          <OtpModal
            onSubmit={(code) => void handleOtpSubmit(code)}
            onCancel={handleOtpCancel}
            onResend={() => void handleOtpResend()}
            error={otpError}
            verifying={phase === 'verifying_otp'}
          />
        </>
      )}

      {phase === 'error' && (
        <>
          <SyncProgressStepper steps={steps} />
          <div className={styles.errorBox} role="alert">
            <p>{errorMessage}</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={handleRetry}>
            Retry
          </button>
        </>
      )}

      {phase === 'complete' && syncSummary && (
        <>
          <SyncResultsSummary
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

function buildSteps(phase: SyncPhase): Array<{ label: string; status: StepStatus }> {
  const phaseOrder: SyncPhase[] = ['authenticating', 'awaiting_otp', 'fetching', 'complete'];
  const labels = ['Logging in...', 'Waiting for OTP...', 'Discovering accounts...', 'Syncing holdings...'];
  const currentIdx = phaseOrder.indexOf(
    phase === 'verifying_otp' ? 'awaiting_otp'
      : phase === 'entering_credentials' ? 'authenticating'
      : phase === 'error' ? 'authenticating'
      : phase,
  );

  return labels.map((label, i) => {
    let status: StepStatus = 'pending';
    if (phase === 'error') {
      // Find the failed step — it's the last one that was active
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
