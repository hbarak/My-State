import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import styles from './OtpModal.module.css';

interface OtpModalProps {
  readonly onSubmit: (code: string) => void;
  readonly onCancel: () => void;
  readonly onResend: () => void;
  readonly error: string | null;
  readonly verifying: boolean;
}

const OTP_DURATION_S = 180;
const RESEND_COOLDOWN_S = 30;

export function OtpModal({
  onSubmit,
  onCancel,
  onResend,
  error,
  verifying,
}: OtpModalProps): JSX.Element {
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(OTP_DURATION_S);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const expired = secondsLeft <= 0;

  // Countdown timer
  useEffect(() => {
    if (expired) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [expired]);

  // Resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clear code on error; expire countdown on otp_expired
  useEffect(() => {
    if (error) {
      setCode('');
      if (error.toLowerCase().includes('expired')) {
        setSecondsLeft(0);
      }
      inputRef.current?.focus();
    }
  }, [error]);

  const handleCodeChange = useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, '').slice(0, 6);
      setCode(digits);
      if (digits.length === 6 && !expired && !verifying) {
        onSubmit(digits);
      }
    },
    [expired, verifying, onSubmit],
  );

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (code.length === 6 && !expired && !verifying) {
      onSubmit(code);
    }
  };

  const handleResend = (): void => {
    if (resendCooldown > 0) return;
    setCode('');
    setSecondsLeft(OTP_DURATION_S);
    setResendCooldown(RESEND_COOLDOWN_S);
    onResend();
  };

  const mm = String(Math.floor(secondsLeft / 60)).padStart(1, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  const countdownClass = secondsLeft <= 30 ? styles.countdownUrgent : styles.countdown;

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Enter OTP Code">
        <h3 className={styles.heading}>Enter OTP Code</h3>
        <p className={styles.description}>
          A verification code was sent to your phone via SMS.
        </p>

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className={`${styles.otpInput} ${error ? styles.otpInputError : ''}`}
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            disabled={expired || verifying}
            placeholder="------"
          />

          {error && <p className={styles.inlineError}>{error}</p>}

          <p className={expired ? styles.countdownExpired : countdownClass}>
            {expired ? 'Code expired' : `Code expires in ${mm}:${ss}`}
          </p>

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.verifyButton}
              disabled={code.length < 6 || expired || verifying}
            >
              {verifying ? 'Verifying\u2026' : 'Verify'}
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={onCancel}
              disabled={verifying}
            >
              Cancel
            </button>
          </div>
        </form>

        <p className={styles.resendRow}>
          {"Didn\u2019t receive it? "}
          <button
            type="button"
            className={styles.resendLink}
            onClick={handleResend}
            disabled={resendCooldown > 0 || verifying}
          >
            {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
          </button>
        </p>
      </div>
    </div>
  );
}
