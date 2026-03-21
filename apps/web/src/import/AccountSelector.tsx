import { ChangeEvent, FormEvent, useState } from 'react';
import type { Account } from '../../../../packages/domain/src/types/account';
import styles from './AccountSelector.module.css';

interface AccountSelectorProps {
  readonly accounts: readonly Account[];
  readonly selectedAccountId: string | null;
  readonly onSelect: (accountId: string) => void;
  readonly onCreate: (params: { id: string; name: string }) => Promise<void>;
  readonly disabled?: boolean;
}

export function AccountSelector({
  accounts,
  selectedAccountId,
  onSelect,
  onCreate,
  disabled = false,
}: AccountSelectorProps): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (event: ChangeEvent<HTMLSelectElement>): void => {
    onSelect(event.target.value);
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedId = newId.trim();
    const trimmedName = newName.trim();

    if (!trimmedName) {
      setError('Account name is required.');
      return;
    }

    const id = trimmedId || trimmedName.toLowerCase().replace(/\s+/g, '-');

    setCreating(true);
    setError(null);
    try {
      await onCreate({ id, name: trimmedName });
      setNewId('');
      setNewName('');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = (): void => {
    setShowForm(false);
    setNewId('');
    setNewName('');
    setError(null);
  };

  return (
    <div className={styles.selector}>
      <label className={styles.label} htmlFor="account-select">Account</label>
      <select
        id="account-select"
        className={styles.select}
        value={selectedAccountId ?? ''}
        onChange={handleSelect}
        disabled={disabled}
      >
        {accounts.length === 0 && <option value="">No accounts</option>}
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>

      {!showForm && (
        <button
          type="button"
          className={styles.addNew}
          onClick={() => setShowForm(true)}
          disabled={disabled}
        >
          + Add new account
        </button>
      )}

      {showForm && (
        <form className={styles.inlineForm} onSubmit={(e) => void handleSubmit(e)}>
          <input
            className={styles.input}
            type="text"
            placeholder="Account name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={creating}
            autoFocus
          />
          <input
            className={styles.input}
            type="text"
            placeholder="Account ID (optional)"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            disabled={creating}
          />
          <button type="submit" className={styles.createButton} disabled={creating || !newName.trim()}>
            Create
          </button>
          <button type="button" className={styles.cancelButton} onClick={handleCancel} disabled={creating}>
            Cancel
          </button>
        </form>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
