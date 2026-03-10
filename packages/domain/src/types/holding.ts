import { CurrencyCode, ISODateTime } from './common';

export type AssetType = 'stock' | 'etf' | 'bond' | 'crypto' | 'cash' | 'other';

export interface Holding {
  id: string;
  accountId: string;
  symbol: string;
  assetType: AssetType;
  quantity: number;
  avgCost?: number;
  costCurrency?: CurrencyCode;
  marketPrice?: number;
  marketValue?: number;
  marketCurrency?: CurrencyCode;
  asOf: ISODateTime;
  source: 'manual' | 'broker_sync' | 'import';
  metadata?: Record<string, string | number | boolean | null>;
}
