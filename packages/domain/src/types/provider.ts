import { ISODateTime } from './common';

export type ProviderKind = 'document' | 'api' | 'manual';
export type ProviderStatus = 'active' | 'inactive';
export type ProviderDataDomain =
  | 'cash_transactions'
  | 'trades'
  | 'holdings'
  | 'billing_cycles'
  | 'credit_card_statements'
  | 'account_balances'
  | 'other';
export type ProviderCommunicationMethod =
  | 'document_csv'
  | 'document_pdf'
  | 'api_pull'
  | 'api_webhook'
  | 'manual_entry';
export type ProviderSyncMode = 'manual' | 'scheduled' | 'realtime';
export type ProviderDirection = 'ingest' | 'export' | 'bidirectional';

export interface Provider {
  id: string;
  name: string;
  status: ProviderStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ProviderIntegration {
  id: string;
  providerId: string;
  kind: ProviderKind;
  dataDomain: ProviderDataDomain;
  communicationMethod: ProviderCommunicationMethod;
  syncMode: ProviderSyncMode;
  direction: ProviderDirection;
  adapterKey: string;
  mappingProfileId?: string;
  isEnabled: boolean;
  notes?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type MappingInputFormat = 'csv' | 'pdf' | 'json';

export interface ProviderMappingProfile {
  id: string;
  providerId: string;
  providerIntegrationId: string;
  name: string;
  version: number;
  isActive: boolean;
  inputFormat: MappingInputFormat;
  headerFingerprint?: string;
  fieldMappings: Record<string, string>;
  requiredCanonicalFields: string[];
  optionalCanonicalFields?: string[];
  valueMappings?: Record<string, Record<string, string>>;
  parsingRules?: Record<string, string | number | boolean>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ProviderAccountMapping {
  id: string;
  providerId: string;
  providerAccountRef: string;
  accountId: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ProviderSymbolMapping {
  id: string;
  providerId: string;
  providerSymbol: string;
  symbol: string;
  displaySymbol: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
