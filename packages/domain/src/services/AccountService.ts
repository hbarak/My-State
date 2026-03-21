import type { Account } from '../types';
import type { PortfolioRepository } from '../repositories';

interface CreateAccountParams {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
}

export class AccountService {
  constructor(private readonly repository: PortfolioRepository) {}

  async createAccount(params: CreateAccountParams): Promise<Account> {
    const existing = await this.repository.getAccount(params.id);
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

  async getById(accountId: string): Promise<Account | null> {
    return this.repository.getAccount(accountId);
  }

  async listByProvider(providerId: string): Promise<Account[]> {
    return this.repository.listAccountsByProvider(providerId);
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
