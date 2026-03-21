import { ChangeEvent, FormEvent, useState } from 'react';
import type { Account } from '../../../../packages/domain/src/types/account';
import styles from './AccountSelector.module.css';

type FormMode = 'idle' | 'create' | 'rename';

interface AccountSelectorProps {
  readonly accounts: readonly Account[];
  readonly selectedAccountId: string | null;
  readonly onSelect: (accountId: string) => void;
  readonly onCreate: (params: { id: string; name: string }) => Promise<void>;
  readonly onRename: (accountId: string, name: string) => Promise<void>;
  readonly disabled?: boolean;
}

export function AccountSelector({
  accounts,
  selectedAccountId,
  onSelect,
  onCreate,
  onRename,
  disabled = false,
}: AccountSelectorProps): JSX.Element {
  const [formMode, setFormMode] = useState<FormMode>('idle');
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [renameName, setRenameName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  const handleSelect = (event: ChangeEvent<HTMLSelectElement>): void => {
    onSelect(event.target.value);
  };

  const handleCreateSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedId = newId.trim();
    const trimmedName = newName.trim();

    if (!trimmedName) {
      setError('Account name is required.');
      return;
    }

    const id = trimmedId || trimmedName.toLowerCase().replace(/\s+/g, '-');

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ id, name: trimmedName });
      setNewId('');
      setNewName('');
      setFormMode('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRenameSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedName = renameName.trim();

    if (!trimmedName) {
      setError('Account name is required.');
      return;
    }

    if (!selectedAccountId) {
      setError('No account selected.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onRename(selectedAccountId, trimmedName);
      setRenameName('');
      setFormMode('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename account');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = (): void => {
    setFormMode('idle');
    setNewId('');
    setNewName('');
    setRenameName('');
    setError(null);
  };

  const startRename = (): void => {
    setRenameName(selectedAccount?.name ?? '');
    setError(null);
    setFormMode('rename');
  };

  return (
    <div className={styles.selector}>
      <label className={styles.label} htmlFor="account-select">Account</label>
      <div className={styles.selectRow}>
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
        {selectedAccount && formMode === 'idle' && (
          <button
            type="button"
            className={styles.editButton}
            onClick={startRename}
            disabled={disabled}
            title="Rename account"
          >
            Rename
          </button>
        )}
      </div>

      {formMode === 'idle' && (
        <button
          type="button"
          className={styles.addNew}
          onClick={() => setFormMode('create')}
          disabled={disabled}
        >
          + Add new account
        </button>
      )}

      {formMode === 'create' && (
        <form className={styles.inlineForm} onSubmit={(e) => void handleCreateSubmit(e)}>
          <input
            className={styles.input}
            type="text"
            placeholder="Account name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          <input
            className={styles.input}
            type="text"
            placeholder="Account ID (optional)"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            disabled={submitting}
          />
          <button type="submit" className={styles.createButton} disabled={submitting || !newName.trim()}>
            Create
          </button>
          <button type="button" className={styles.cancelButton} onClick={handleCancel} disabled={submitting}>
            Cancel
          </button>
        </form>
      )}

      {formMode === 'rename' && (
        <form className={styles.renameForm} onSubmit={(e) => void handleRenameSubmit(e)}>
          <input
            className={styles.input}
            type="text"
            placeholder="New account name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          <button type="submit" className={styles.createButton} disabled={submitting || !renameName.trim()}>
            Save
          </button>
          <button type="button" className={styles.cancelButton} onClick={handleCancel} disabled={submitting}>
            Cancel
          </button>
        </form>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
