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

/**
 * What user data a provider can contribute to the system.
 *
 * These are distinct from DataSourceCapability (market data).
 * A provider holds your data — a broker, a bank, a CSV export.
 *
 * When onboarding a new provider, check each capability:
 * - `holdings_import`    — can it supply current positions + cost basis?
 * - `trade_import`       — can it supply buy/sell transaction history?
 * - `account_discovery`  — can it list the user's accounts automatically?
 */
export type ProviderCapability =
  | 'holdings_import'
  | 'trade_import'
  | 'account_discovery';

/**
 * How the provider authenticates the user.
 *
 * - `none`      — no auth (CSV uploads, manual entry)
 * - `otp_2fa`   — SMS/email OTP (Psagot)
 * - `oauth`     — OAuth 2.0 (future)
 * - `gateway`   — local gateway manages auth (IB Client Portal, future)
 */
export type ProviderAuthMethod = 'none' | 'otp_2fa' | 'oauth' | 'gateway';

export interface Provider {
  id: string;
  name: string;
  status: ProviderStatus;

  /**
   * What user data this provider can supply.
   * Declared at registration time, drives UI and integration logic.
   * A provider with no capabilities is a passive container (e.g. manual-entry-only).
   */
  capabilities?: readonly ProviderCapability[];

  /**
   * How this provider authenticates the user.
   * Informs the UI which auth flow to present (OTP dialog, OAuth redirect, etc.).
   */
  authMethod?: ProviderAuthMethod;

  /**
   * If this provider also supplies market data (prices, metadata, etc.),
   * this links to the DataSource that shares its session.
   * Set after the DataSource is registered.
   */
  linkedDataSourceId?: string;

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
