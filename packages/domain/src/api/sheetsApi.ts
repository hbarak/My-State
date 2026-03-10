import { SYNC_CONFIG } from '../config/sync';
import { Transaction } from '../types';

export interface SheetsApi {
  fetchAll(): Promise<Transaction[]>;
  append(transaction: Transaction): Promise<void>;
}

export class GasSheetsApi implements SheetsApi {
  constructor(
    private readonly endpointUrl: string = SYNC_CONFIG.endpointUrl,
    private readonly secretToken: string = SYNC_CONFIG.secretToken,
    private readonly requestTimeoutMs: number = SYNC_CONFIG.requestTimeoutMs,
  ) {}

  async fetchAll(): Promise<Transaction[]> {
    return this.request<Transaction[]>('GET');
  }

  async append(transaction: Transaction): Promise<void> {
    await this.request<unknown>('POST', transaction);
  }

  private async request<T>(method: 'GET' | 'POST', payload?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const res = await fetch(this.endpointUrl, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.secretToken, data: payload }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Sync request failed: ${res.status} ${text}`);
      }

      if (method === 'GET') {
        const parsed = (await res.json()) as unknown;
        return this.normalizeTransactions(parsed) as T;
      }

      return undefined as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Sync request timed out after ${this.requestTimeoutMs}ms`);
      }

      if (error instanceof Error) {
        throw new Error(`Sync request failed: ${error.message}`);
      }

      throw new Error('Sync request failed for an unknown reason');
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeTransactions(payload: unknown): Transaction[] {
    if (!Array.isArray(payload)) {
      throw new Error('Invalid GET response: expected an array of transactions');
    }

    return payload
      .map((item) => this.toTransaction(item))
      .filter((item): item is Transaction => item !== null);
  }

  private toTransaction(value: unknown): Transaction | null {
    if (!value || typeof value !== 'object') return null;

    const item = value as Partial<Transaction>;
    if (
      typeof item.id !== 'string' ||
      typeof item.date !== 'string' ||
      typeof item.category !== 'string' ||
      typeof item.amount !== 'number' ||
      typeof item.currency !== 'string' ||
      typeof item.payer !== 'string'
    ) {
      return null;
    }

    if (typeof item.note !== 'undefined' && typeof item.note !== 'string') {
      return null;
    }

    return {
      id: item.id,
      date: item.date,
      category: item.category,
      amount: item.amount,
      currency: item.currency,
      payer: item.payer,
      note: item.note,
    };
  }
}
