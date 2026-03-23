import styles from './ApiSyncCard.module.css';

export type StepStatus = 'pending' | 'active' | 'complete' | 'failed';

interface Step {
  readonly label: string;
  readonly status: StepStatus;
}

interface SyncProgressStepperProps {
  readonly steps: readonly Step[];
}

const STATUS_ICON: Record<StepStatus, string> = {
  pending: '\u25CB',   // ○
  active: '',          // CSS spinner
  complete: '\u2713',  // ✓
  failed: '\u2717',    // ✗
};

const STATUS_CLASS: Record<StepStatus, string> = {
  pending: styles.stepPending,
  active: styles.stepActive,
  complete: styles.stepComplete,
  failed: styles.stepFailed,
};

export function SyncProgressStepper({ steps }: SyncProgressStepperProps): JSX.Element {
  return (
    <ol className={styles.stepper}>
      {steps.map((step, i) => (
        <li key={i} className={`${styles.step} ${STATUS_CLASS[step.status]}`}>
          <span className={styles.stepIcon}>
            {step.status === 'active' ? (
              <span className={styles.spinner} />
            ) : (
              STATUS_ICON[step.status]
            )}
          </span>
          <span className={styles.stepLabel}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
