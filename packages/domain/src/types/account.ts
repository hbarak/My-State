import { CurrencyCode, ISODateTime } from './common';

export type AccountType = 'bank' | 'brokerage' | 'credit_card' | 'wallet' | 'cash' | 'other';
export type ProviderType = 'manual' | 'plaid' | 'tink' | 'truelayer' | 'ibkr' | 'other';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  provider: ProviderType;
  providerAccountId?: string;
  baseCurrency: CurrencyCode;
  institutionName?: string;
  lastSyncAt?: ISODateTime;
  isActive: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
