import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { AccountService, ensureDefaultAccounts } from '../src/services/AccountService';
import type { PsagotAccount } from '../src/types';

class InMemoryStore implements JsonStore {
  private readonly mem = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.mem.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
  }
}

const PROVIDER_ID = 'provider-psagot';

function makeFixture() {
  const store = new InMemoryStore();
  const repository = new LocalPortfolioRepository(store);
  const service = new AccountService(repository);
  return { store, repository, service };
}

const API_ACCOUNTS: PsagotAccount[] = [
  { key: '150-190500', name: 'ישראל ישראלי', nickname: 'טווח קצר' },
  { key: '150-190501', name: 'ישראל ישראלי', nickname: 'טווח ארוך' },
  { key: '150-190502', name: 'ישראל ישראלי', nickname: '' },
];

describe('Account Auto-Discovery', () => {
  // ── Discovery from API ──

  it('D1: new accounts created from API response', async () => {
    const { service } = makeFixture();

    const result = await service.discoverAccounts({ providerId: PROVIDER_ID, apiAccounts: API_ACCOUNTS });

    expect(result.created).toHaveLength(3);
    expect(result.created.map((a) => a.id)).toEqual(['150-190500', '150-190501', '150-190502']);
  });

  it('D2: broker nickname used as account display name', async () => {
    const { service } = makeFixture();

    const result = await service.discoverAccounts({ providerId: PROVIDER_ID, apiAccounts: API_ACCOUNTS });

    const shortTerm = result.created.find((a) => a.id === '150-190500');
    expect(shortTerm?.name).toBe('טווח קצר');
  });

  it('D3: account ID uses branch-number format from API', async () => {
    const { service } = makeFixture();

    const result = await service.discoverAccounts({ providerId: PROVIDER_ID, apiAccounts: API_ACCOUNTS });

    expect(result.created[0].id).toBe('150-190500');
    expect(result.created[0].providerId).toBe(PROVIDER_ID);
  });

  it('D4: empty nickname falls back to account key as name', async () => {
    const { service } = makeFixture();

    const result = await service.discoverAccounts({ providerId: PROVIDER_ID, apiAccounts: API_ACCOUNTS });

    const noNickname = result.created.find((a) => a.id === '150-190502');
    expect(noNickname?.name).toBe('150-190502');
  });

  // ── Merge with Existing Accounts ──

  it('G1: existing account with matching ID is updated (not duplicated)', async () => {
    const { service, repository } = makeFixture();

    await service.createAccount({ id: '150-190500', providerId: PROVIDER_ID, name: 'My Account' });

    const result = await service.discoverAccounts({
      providerId: PROVIDER_ID,
      apiAccounts: [{ key: '150-190500', name: 'ישראל ישראלי', nickname: 'טווח קצר' }],
    });

    expect(result.created).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].name).toBe('טווח קצר');

    const all = await repository.listAccountsByProvider(PROVIDER_ID);
    expect(all).toHaveLength(1);
  });

  it('G2: existing account with user-customized name preserves user name', async () => {
    const { service } = makeFixture();

    // Create account then rename it (simulates user customization)
    await service.createAccount({ id: '150-190500', providerId: PROVIDER_ID, name: 'טווח קצר' });
    await service.updateAccount(PROVIDER_ID, '150-190500', { name: 'My Custom Name' });

    const result = await service.discoverAccounts({
      providerId: PROVIDER_ID,
      apiAccounts: [{ key: '150-190500', name: 'ישראל ישראלי', nickname: 'טווח קצר' }],
    });

    // User customized → name should be preserved
    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0].name).toBe('My Custom Name');
  });

  it('G3: new account from API coexists with user-created accounts', async () => {
    const { service, repository } = makeFixture();

    await service.createAccount({ id: 'my-account', providerId: PROVIDER_ID, name: 'Manual Account' });

    await service.discoverAccounts({
      providerId: PROVIDER_ID,
      apiAccounts: [{ key: '150-190500', name: 'ישראל ישראלי', nickname: 'טווח קצר' }],
    });

    const all = await repository.listAccountsByProvider(PROVIDER_ID);
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.id).sort()).toEqual(['150-190500', 'my-account']);
  });

  it('G4: discovery is idempotent — second sync creates no duplicates', async () => {
    const { service, repository } = makeFixture();

    await service.discoverAccounts({ providerId: PROVIDER_ID, apiAccounts: API_ACCOUNTS });
    await service.discoverAccounts({ providerId: PROVIDER_ID, apiAccounts: API_ACCOUNTS });

    const all = await repository.listAccountsByProvider(PROVIDER_ID);
    expect(all).toHaveLength(3);
  });

  // ── AccountService shared methods ──

  it('AS1: updateAccount throws when account does not exist', async () => {
    const { service } = makeFixture();

    await expect(
      service.updateAccount(PROVIDER_ID, 'nonexistent', { name: 'New Name' }),
    ).rejects.toThrow('Account not found: nonexistent');
  });

  it('AS2: getById returns account when it exists', async () => {
    const { service } = makeFixture();

    await service.createAccount({ id: '150-190500', providerId: PROVIDER_ID, name: 'Test' });
    const account = await service.getById(PROVIDER_ID, '150-190500');

    expect(account).not.toBeNull();
    expect(account?.id).toBe('150-190500');
  });

  it('AS3: getById returns null when account does not exist', async () => {
    const { service } = makeFixture();

    const account = await service.getById(PROVIDER_ID, 'missing');
    expect(account).toBeNull();
  });

  it('AS4: listByProvider returns all accounts for provider', async () => {
    const { service } = makeFixture();

    await service.createAccount({ id: 'acc-1', providerId: PROVIDER_ID, name: 'Account 1' });
    await service.createAccount({ id: 'acc-2', providerId: PROVIDER_ID, name: 'Account 2' });
    await service.createAccount({ id: 'acc-3', providerId: 'other-provider', name: 'Other' });

    const accounts = await service.listByProvider(PROVIDER_ID);
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.id).sort()).toEqual(['acc-1', 'acc-2']);
  });

  it('AS5: ensureDefaultAccounts creates default account for provider with no accounts', async () => {
    const { repository } = makeFixture();

    await repository.upsertProvider({
      id: PROVIDER_ID,
      name: 'Psagot',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await ensureDefaultAccounts(repository);

    const accounts = await repository.listAccountsByProvider(PROVIDER_ID);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('default');
  });

  it('AS6: ensureDefaultAccounts is idempotent — skips provider that already has accounts', async () => {
    const { repository, service } = makeFixture();

    await repository.upsertProvider({
      id: PROVIDER_ID,
      name: 'Psagot',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await service.createAccount({ id: 'existing', providerId: PROVIDER_ID, name: 'Existing' });

    await ensureDefaultAccounts(repository);

    const accounts = await repository.listAccountsByProvider(PROVIDER_ID);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('existing');
  });

  // ── Default Account Merge ──

  it('M1: default account silently merged into real account ID from API', async () => {
    const { service, repository } = makeFixture();

    // Seed: default account + a holding record + an import run referencing 'default'
    const now = new Date().toISOString();
    await repository.upsertAccount({ id: 'default', providerId: PROVIDER_ID, name: 'Default Account', createdAt: now, updatedAt: now });
    await repository.addImportRun({
      id: 'run-1',
      providerId: PROVIDER_ID,
      providerIntegrationId: 'csv-integration',
      accountId: 'default',
      sourceName: 'test.csv',
      status: 'success',
      startedAt: now,
      importedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      isUndoable: true,
    });
    await repository.upsertHoldingRecords([{
      id: 'hr-1',
      providerId: PROVIDER_ID,
      providerIntegrationId: 'csv-integration',
      accountId: 'default',
      importRunId: 'run-1',
      securityId: 'AAA',
      securityName: 'AAA Corp',
      actionType: 'קניה',
      quantity: 10,
      costBasis: 100,
      currency: 'ILS',
      actionDate: '2026-01-01',
      createdAt: now,
      updatedAt: now,
    }]);

    // Discover: API tells us the real account ID is '123456789'
    const result = await service.discoverAccounts({
      providerId: PROVIDER_ID,
      apiAccounts: [{ key: '123456789', name: 'ישראל ישראלי', nickname: 'Main' }],
    });

    // After merge: only 1 account should exist, with real ID
    const accounts = await repository.listAccountsByProvider(PROVIDER_ID);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe('123456789');
    expect(result.created).toHaveLength(1);
    expect(result.created[0].id).toBe('123456789');

    // Holding records should now reference the real account ID
    const records = await repository.listHoldingRecordsByAccount(PROVIDER_ID, '123456789');
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('hr-1');

    // Import run should now reference the real account ID
    const runs = await repository.listImportRunsByProvider(PROVIDER_ID);
    expect(runs[0].accountId).toBe('123456789');
  });

  it('M2: merge preserves createdAt from the default account', async () => {
    const { service, repository } = makeFixture();

    const createdAt = '2025-01-15T00:00:00.000Z';
    await repository.upsertAccount({ id: 'default', providerId: PROVIDER_ID, name: 'Default Account', createdAt, updatedAt: createdAt });

    await service.discoverAccounts({
      providerId: PROVIDER_ID,
      apiAccounts: [{ key: '999-111', name: 'ישראל ישראלי', nickname: 'Account' }],
    });

    const account = await repository.getAccount(PROVIDER_ID, '999-111');
    expect(account?.createdAt).toBe(createdAt);
  });

  it('M3: no merge when API account ID already exists (not a default account)', async () => {
    const { service, repository } = makeFixture();

    const now = new Date().toISOString();
    await repository.upsertAccount({ id: '150-190500', providerId: PROVIDER_ID, name: 'Existing', createdAt: now, updatedAt: now });
    await repository.upsertAccount({ id: 'default', providerId: PROVIDER_ID, name: 'Default Account', createdAt: now, updatedAt: now });

    await service.discoverAccounts({
      providerId: PROVIDER_ID,
      apiAccounts: [{ key: '150-190500', name: 'ישראל ישראלי', nickname: 'Main' }],
    });

    // Both accounts remain — existing real account found, no merge with default
    const accounts = await repository.listAccountsByProvider(PROVIDER_ID);
    expect(accounts.map((a) => a.id).sort()).toEqual(['150-190500', 'default']);
  });

  it('G5: discovery adds new account when API returns previously unknown account', async () => {
    const { service, repository } = makeFixture();

    await service.discoverAccounts({
      providerId: PROVIDER_ID,
      apiAccounts: API_ACCOUNTS.slice(0, 2),
    });

    const result = await service.discoverAccounts({
      providerId: PROVIDER_ID,
      apiAccounts: API_ACCOUNTS,
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0].id).toBe('150-190502');

    const all = await repository.listAccountsByProvider(PROVIDER_ID);
    expect(all).toHaveLength(3);
  });
});
