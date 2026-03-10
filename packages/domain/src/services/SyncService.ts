import AsyncStorage from '@react-native-async-storage/async-storage';
import { GasSheetsApi, SheetsApi } from '../api/sheetsApi';
import { LocalTransaction, Transaction } from '../types';

const STORAGE_KEY = 'transactions.v1';

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

class AsyncStorageAdapter implements StorageAdapter {
  getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }

  setItem(key: string, value: string): Promise<void> {
    return AsyncStorage.setItem(key, value);
  }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  localCount: number;
}

export class SyncService {
  private readonly api: SheetsApi;
  private readonly storage: StorageAdapter;

  constructor(api: SheetsApi = new GasSheetsApi(), storage: StorageAdapter = new AsyncStorageAdapter()) {
    this.api = api;
    this.storage = storage;
  }

  async getLocalTransactions(): Promise<LocalTransaction[]> {
    const raw = await this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as LocalTransaction[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async addLocalTransaction(tx: Transaction): Promise<LocalTransaction[]> {
    const list = await this.getLocalTransactions();
    const next: LocalTransaction = { ...tx, isSynced: false };
    const updated = [next, ...list];
    await this.persist(updated);
    return updated;
  }

  async markSynced(ids: string[]): Promise<LocalTransaction[]> {
    const list = await this.getLocalTransactions();
    const updated = list.map((tx) => (ids.includes(tx.id) ? { ...tx, isSynced: true } : tx));
    await this.persist(updated);
    return updated;
  }

  async sync(): Promise<SyncResult> {
    const local = await this.getLocalTransactions();
    const dirty = local.filter((tx) => !tx.isSynced);
    const syncedIds: string[] = [];

    let pushed = 0;
    for (const tx of dirty) {
      await this.api.append(stripSyncFlag(tx));
      syncedIds.push(tx.id);
      pushed += 1;
    }

    const locallyMarked = applySyncedIds(local, syncedIds);
    await this.persist(locallyMarked);

    const remote = await this.api.fetchAll();
    const merged = mergeLocalWithRemote(locallyMarked, remote);
    await this.persist(merged);

    return {
      pushed,
      pulled: remote.length,
      localCount: merged.length,
    };
  }

  private async persist(list: LocalTransaction[]): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(list));
  }
}

function stripSyncFlag(tx: LocalTransaction): Transaction {
  const { isSynced: _isSynced, ...rest } = tx;
  return rest;
}

function applySyncedIds(local: LocalTransaction[], ids: string[]): LocalTransaction[] {
  if (ids.length === 0) return local;
  const idSet = new Set(ids);
  return local.map((tx) => (idSet.has(tx.id) ? { ...tx, isSynced: true } : tx));
}

function mergeLocalWithRemote(
  local: LocalTransaction[],
  remote: Transaction[],
): LocalTransaction[] {
  const byId = new Map<string, LocalTransaction>();

  for (const tx of local) {
    byId.set(tx.id, tx);
  }

  for (const tx of remote) {
    const existing = byId.get(tx.id);
    if (!existing) {
      byId.set(tx.id, { ...tx, isSynced: true });
      continue;
    }

    if (existing.isSynced) {
      byId.set(tx.id, { ...tx, isSynced: true });
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.date.localeCompare(a.date));
}
