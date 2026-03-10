import { CurrencyCode, ISODate, ISODateTime } from './common';

export type TransactionDirection = 'debit' | 'credit';
export type TransactionSource = 'manual' | 'bank_sync' | 'broker_sync' | 'import';

export interface Transaction {
  id: string;
  accountId?: string;
  externalId?: string;
  date: ISODate;
  bookedAt?: ISODateTime;
  category: string;
  amount: number;
  currency: CurrencyCode;
  payer: string;
  note?: string;
  direction?: TransactionDirection;
  source?: TransactionSource;
  tags?: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface LocalTransaction extends Transaction {
  isSynced: boolean;
}
