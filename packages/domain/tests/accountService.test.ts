import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { AccountService } from '../src/services/AccountService';

class InMemoryStore implements JsonStore {
  private readonly mem = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.mem.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
  }
}

function makeFixture() {
  const store = new InMemoryStore();
  const repository = new LocalPortfolioRepository(store);
  const service = new AccountService(repository);
  return { store, repository, service };
}

describe('AccountService', () => {
  // A1: Create account with id, providerId, name -> persisted, retrievable by id
  it('creates an account and retrieves it by id', async () => {
    const { service } = makeFixture();

    const account = await service.createAccount({
      id: 'psagot-joint',
      providerId: 'provider-psagot',
      name: 'Joint Account',
    });

    expect(account.id).toBe('psagot-joint');
    expect(account.providerId).toBe('provider-psagot');
    expect(account.name).toBe('Joint Account');
    expect(account.createdAt).toBeDefined();
    expect(account.updatedAt).toBeDefined();

    const retrieved = await service.getById('psagot-joint');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('psagot-joint');
    expect(retrieved!.name).toBe('Joint Account');
  });

  // A2: List accounts by provider -> returns only that provider's accounts
  it('lists accounts filtered by provider', async () => {
    const { service } = makeFixture();

    await service.createAccount({ id: 'acct-a', providerId: 'prov-1', name: 'A' });
    await service.createAccount({ id: 'acct-b', providerId: 'prov-2', name: 'B' });
    await service.createAccount({ id: 'acct-c', providerId: 'prov-1', name: 'C' });

    const prov1Accounts = await service.listByProvider('prov-1');
    expect(prov1Accounts).toHaveLength(2);
    expect(prov1Accounts.map((a) => a.id).sort()).toEqual(['acct-a', 'acct-c']);
  });

  // A3: Create two accounts under same provider -> both listed
  it('supports multiple accounts under same provider', async () => {
    const { service } = makeFixture();

    await service.createAccount({ id: 'joint', providerId: 'psagot', name: 'Joint' });
    await service.createAccount({ id: 'ira', providerId: 'psagot', name: 'IRA' });

    const accounts = await service.listByProvider('psagot');
    expect(accounts).toHaveLength(2);
  });

  // A4: Create account under provider A, list for provider B -> empty
  it('returns empty list for provider with no accounts', async () => {
    const { service } = makeFixture();

    await service.createAccount({ id: 'acct-x', providerId: 'prov-a', name: 'X' });

    const accounts = await service.listByProvider('prov-b');
    expect(accounts).toHaveLength(0);
  });

  // A5: Get non-existent account -> returns null (not throw)
  it('returns null for non-existent account id', async () => {
    const { service } = makeFixture();

    const result = await service.getById('does-not-exist');
    expect(result).toBeNull();
  });

  // A6: Account has createdAt/updatedAt timestamps set
  it('sets createdAt and updatedAt timestamps on creation', async () => {
    const { service } = makeFixture();

    const before = new Date().toISOString();
    const account = await service.createAccount({
      id: 'ts-test',
      providerId: 'prov',
      name: 'Timestamp Test',
    });
    const after = new Date().toISOString();

    expect(account.createdAt >= before).toBe(true);
    expect(account.createdAt <= after).toBe(true);
    expect(account.updatedAt).toBe(account.createdAt);
  });

  // A7: Create account with duplicate id -> upsert behavior (updates name, preserves createdAt)
  it('upserts on duplicate id — updates name, preserves createdAt', async () => {
    const { service } = makeFixture();

    const original = await service.createAccount({
      id: 'dup-id',
      providerId: 'prov',
      name: 'Original Name',
    });

    const updated = await service.createAccount({
      id: 'dup-id',
      providerId: 'prov',
      name: 'Updated Name',
    });

    expect(updated.name).toBe('Updated Name');
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.updatedAt >= original.updatedAt).toBe(true);

    const accounts = await service.listByProvider('prov');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Updated Name');
  });

  // Regression: existing provider setup tests still pass (no interference from account storage)
  it('account storage does not interfere with provider storage', async () => {
    const { repository, service } = makeFixture();

    await service.createAccount({ id: 'acct-1', providerId: 'prov-1', name: 'Account 1' });

    await repository.upsertProvider({
      id: 'prov-1',
      name: 'Provider 1',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const providers = await repository.getProviders();
    expect(providers).toHaveLength(1);

    const accounts = await service.listByProvider('prov-1');
    expect(accounts).toHaveLength(1);
  });
});
