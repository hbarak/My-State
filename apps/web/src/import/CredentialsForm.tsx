import { type FormEvent, useState } from 'react';
import type { PsagotCredentials } from '../../../../packages/domain/src/types/psagotApi';
import styles from './CredentialsForm.module.css';

interface CredentialsFormProps {
  readonly onSubmit: (credentials: PsagotCredentials) => void;
  readonly disabled?: boolean;
}

export function CredentialsForm({ onSubmit, disabled = false }: CredentialsFormProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = username.trim().length > 0 && password.length > 0 && !disabled;

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ username: username.trim(), password });
    setPassword('');
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h4 className={styles.heading}>Psagot Login</h4>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="psagot-username">
          ID Number
        </label>
        <input
          id="psagot-username"
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={disabled}
          placeholder="e.g. 123456789"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="psagot-password">
          Password
        </label>
        <input
          id="psagot-password"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={disabled}
        />
      </div>

      <button
        type="submit"
        className={styles.submitButton}
        disabled={!canSubmit}
      >
        {disabled ? 'Logging in\u2026' : 'Log In'}
      </button>
    </form>
  );
}
