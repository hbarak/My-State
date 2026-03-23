import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { AccountService } from '../src/services/AccountService';
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
