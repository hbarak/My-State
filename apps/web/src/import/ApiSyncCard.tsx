import { useCallback, useRef, useState } from 'react';
import type { PsagotCredentials, PsagotPendingSession, PsagotApiError } from '../../../../packages/domain/src/types/psagotApi';
import type { ApiSyncSummary } from '../../../../packages/domain/src/services/PsagotApiSyncService';
import type { Account } from '../../../../packages/domain/src/types/account';
import { domain, SPRINT1_PROVIDER_ID, PSAGOT_API_INTEGRATION_ID } from '../domain/bootstrap';
import { CredentialsForm } from './CredentialsForm';
import { OtpModal } from './OtpModal';
import { SyncProgressStepper, type StepStatus } from './SyncProgressStepper';
import { SyncResultsSummary } from './SyncResultsSummary';
import styles from './ApiSyncCard.module.css';

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
}

export function ApiSyncCard({ disabled, onAccountsChanged }: ApiSyncCardProps): JSX.Element {
  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<ApiSyncSummary | null>(null);
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [newAccountCount, setNewAccountCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Held in refs so they never persist beyond the current flow
  const pendingSessionRef = useRef<PsagotPendingSession | null>(null);
  const credentialsRef = useRef<PsagotCredentials | null>(null);

  const isBusy = phase !== 'idle' && phase !== 'complete' && phase !== 'error' && phase !== 'entering_credentials';

  const handleStartSync = useCallback(() => {
    setPhase('entering_credentials');
    setErrorMessage(null);
    setOtpError(null);
    setSyncSummary(null);
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
        providerId: SPRINT1_PROVIDER_ID,
        apiAccounts,
      });

      // Fetch balances for each account
      const accountBalances = await Promise.all(
        apiAccounts.map(async (acct) => ({
          accountId: acct.key,
          balances: await domain.psagotApiClient.fetchBalances(session, acct.key),
        })),
      );

      // Sync all
      const summary = await domain.psagotApiSyncService.syncAllAccounts({
        accountBalances,
        providerId: SPRINT1_PROVIDER_ID,
        providerIntegrationId: PSAGOT_API_INTEGRATION_ID,
        agorotConversion: true,
      });

      // Refresh account list for parent
      const updatedAccounts = await domain.accountService.listByProvider(SPRINT1_PROVIDER_ID);

      setSyncSummary(summary);
      setAccounts(updatedAccounts);
      setNewAccountCount(discovery.created.length);
      setLastSyncedAt(new Date());
      setPhase('complete');
      onAccountsChanged();
    } catch (err) {
      const apiErr = err as PsagotApiError;
      if (apiErr.type === 'otp_invalid') {
        setOtpError(apiErr.message);
        setPhase('awaiting_otp');
        return;
      }
      if (apiErr.type === 'otp_expired') {
        setOtpError(apiErr.message);
        setPhase('awaiting_otp');
        return;
      }
      handleSyncError(err);
    }
  }, [onAccountsChanged]);

  const handleOtpCancel = useCallback(() => {
    pendingSessionRef.current = null;
    credentialsRef.current = null;
    setPhase('idle');
    setOtpError(null);
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
  }, []);

  const handleSyncAgain = useCallback(() => {
    setPhase('idle');
    setSyncSummary(null);
    setErrorMessage(null);
  }, []);

  function handleSyncError(err: unknown): void {
    pendingSessionRef.current = null;
    credentialsRef.current = null;
    const apiErr = err as PsagotApiError;
    setErrorMessage(apiErr.message ?? 'An unexpected error occurred.');
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
          <div className={styles.errorBox}>
            <p>{errorMessage}</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={handleRetry}>
            Retry
          </button>
        </>
      )}

      {phase === 'complete' && syncSummary && (
        <SyncResultsSummary
          summary={syncSummary}
          accounts={accounts}
          newAccountCount={newAccountCount}
          onSyncAgain={handleSyncAgain}
        />
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
