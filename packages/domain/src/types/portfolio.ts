import { CurrencyCode, ISODateTime, SyncStatus } from './common';

export type TradeSide = 'buy' | 'sell';

export interface PortfolioImportRun {
  id: string;
  providerId: string;
  providerIntegrationId: string;
  accountId?: string;
  sourceName: string;
  status: SyncStatus;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
  isUndoable: boolean;
  undoneAt?: ISODateTime;
  errorMessage?: string;
}

export interface RawImportRow {
  id: string;
  importRunId: string;
  providerId: string;
  providerIntegrationId: string;
  rowNumber: number;
  rowPayload: string;
  rowHash: string;
  isValid: boolean;
  errorCode?: string;
  errorMessage?: string;
  createdAt: ISODateTime;
}

export interface TradeTransaction {
  id: string;
  providerId: string;
  providerIntegrationId: string;
  importRunId?: string;
  accountId: string;
  symbol: string;
  displaySymbol: string;
  externalTradeId?: string;
  side: TradeSide;
  quantity: number;
  price: number;
  fees: number;
  currency: CurrencyCode;
  tradeAt: ISODateTime;
  note?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime;
}

export interface ProviderHoldingRecord {
  id: string;
  providerId: string;
  providerIntegrationId: string;
  importRunId?: string;
  accountId: string;
  securityId: string;
  securityName: string;
  actionType: string;
  quantity: number;
  costBasis: number;
  currency: CurrencyCode;
  actionDate: string; // ISO date
  currentPrice?: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime;
}

export interface PositionLot {
  id: string;
  providerId: string;
  accountId: string;
  symbol: string;
  buyTradeId: string;
  originalQty: number;
  openQty: number;
  costPerUnit: number;
  feesAllocated: number;
  openedAt: ISODateTime;
  updatedAt: ISODateTime;
  closedAt?: ISODateTime;
}

export interface LotMatch {
  id: string;
  providerId: string;
  accountId: string;
  symbol: string;
  sellTradeId: string;
  buyLotId: string;
  matchedQty: number;
  buyCostPerUnit: number;
  sellPricePerUnit: number;
  matchedAt: ISODateTime;
}

export interface HoldingSnapshot {
  id: string;
  accountId: string;
  symbol: string;
  quantity: number;
  averageCost: number;
  currency: CurrencyCode;
  asOf: ISODateTime;
}

/**
 * Alias for ProviderHoldingRecord — each record represents a single purchase lot
 * (one buy event with its own date, quantity, and cost basis), not an aggregate snapshot.
 */
export type HoldingLot = ProviderHoldingRecord;
