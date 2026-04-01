import type { Account, PsagotAccount } from '../types';
import type { PortfolioRepository } from '../repositories';

interface DiscoverAccountsParams {
  readonly providerId: string;
  readonly apiAccounts: readonly PsagotAccount[];
}

interface DiscoveryResult {
  readonly created: Account[];
  readonly updated: Account[];
  readonly unchanged: Account[];
}

interface CreateAccountParams {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
}

interface UpdateAccountParams {
  readonly name: string;
}

export class AccountService {
  constructor(private readonly repository: PortfolioRepository) {}

  async createAccount(params: CreateAccountParams): Promise<Account> {
    const existing = await this.repository.getAccount(params.providerId, params.id);
    const now = new Date().toISOString();

    const account: Account = {
      id: params.id,
      providerId: params.providerId,
      name: params.name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.repository.upsertAccount(account);
    return account;
  }

  async updateAccount(providerId: string, accountId: string, params: UpdateAccountParams): Promise<Account> {
    const existing = await this.repository.getAccount(providerId, accountId);
    if (!existing) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const updated: Account = {
      ...existing,
      name: params.name,
      isNameCustomized: true,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.upsertAccount(updated);
    return updated;
  }

  async getById(providerId: string, accountId: string): Promise<Account | null> {
    return this.repository.getAccount(providerId, accountId);
  }

  async listByProvider(providerId: string): Promise<Account[]> {
    return this.repository.listAccountsByProvider(providerId);
  }

  async discoverAccounts(params: DiscoverAccountsParams): Promise<DiscoveryResult> {
    const now = new Date().toISOString();
    const created: Account[] = [];
    const updated: Account[] = [];
    const unchanged: Account[] = [];

    for (const apiAccount of params.apiAccounts) {
      const existing = await this.repository.getAccount(params.providerId, apiAccount.key);
      const displayName = apiAccount.nickname || apiAccount.key;

      if (!existing) {
        const merged = await this.tryMergeDefaultAccount(params.providerId, apiAccount.key, displayName, now);
        if (merged) {
          created.push(merged);
        } else {
          const account: Account = {
            id: apiAccount.key,
            providerId: params.providerId,
            name: displayName,
            createdAt: now,
            updatedAt: now,
          };
          await this.repository.upsertAccount(account);
          created.push(account);
        }
      } else if (this.shouldUpdateName(existing, apiAccount)) {
        const account: Account = {
          ...existing,
          name: displayName,
          updatedAt: now,
        };
        await this.repository.upsertAccount(account);
        updated.push(account);
      } else {
        unchanged.push(existing);
      }
    }

    return { created, updated, unchanged };
  }

  /**
   * When API discovers a real account key that doesn't exist yet, check if a
   * 'default' placeholder account exists for the same provider. If so, merge
   * silently: rewrite all data referencing 'default' → real ID, delete 'default'.
   */
  private async tryMergeDefaultAccount(
    providerId: string,
    newAccountId: string,
    displayName: string,
    now: string,
  ): Promise<Account | null> {
    const defaultAccount = await this.repository.getAccount(providerId, 'default');
    if (!defaultAccount) return null;

    // Rewrite holding records: 'default' → real ID
    const records = await this.repository.listHoldingRecordsByAccount(providerId, 'default');
    if (records.length > 0) {
      await this.repository.upsertHoldingRecords(
        records.map((r) => ({ ...r, accountId: newAccountId })),
      );
    }

    // Rewrite import runs: 'default' → real ID
    await this.repository.updateImportRunAccountId('default', newAccountId, providerId);

    // Upsert new account record preserving createdAt and isNameCustomized
    const merged: Account = {
      id: newAccountId,
      providerId,
      name: defaultAccount.isNameCustomized ? defaultAccount.name : displayName,
      isNameCustomized: defaultAccount.isNameCustomized,
      createdAt: defaultAccount.createdAt,
      updatedAt: now,
    };
    await this.repository.upsertAccount(merged);

    // Delete the 'default' placeholder
    await this.repository.deleteAccount(providerId, 'default');

    return merged;
  }

  private shouldUpdateName(existing: Account, apiAccount: PsagotAccount): boolean {
    if (existing.isNameCustomized) return false;
    const apiDisplayName = apiAccount.nickname || apiAccount.key;
    return existing.name !== apiDisplayName;
  }
}

/**
 * Bootstrap migration: creates a "default" account for each provider that has
 * no accounts yet. Idempotent — skips providers that already have any account.
 */
export async function ensureDefaultAccounts(repository: PortfolioRepository): Promise<void> {
  const providers = await repository.getProviders();
  const now = new Date().toISOString();

  for (const provider of providers) {
    const existing = await repository.listAccountsByProvider(provider.id);
    if (existing.length > 0) continue;

    await repository.upsertAccount({
      id: 'default',
      providerId: provider.id,
      name: 'Default Account',
      createdAt: now,
      updatedAt: now,
    });
  }
}
