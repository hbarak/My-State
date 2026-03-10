import { CurrencyCode, ISODate, ISODateTime } from './common';

export interface TotalHoldingsPosition {
  key: string;
  providerId: string;
  securityId: string;
  securityName: string;
  currency: CurrencyCode;
  quantity: number;
  costBasis: number;
  currentPrice?: number;
  actionDate: ISODate;
  sourceRecordId: string;
  sourceImportRunId?: string;
}

export interface TotalHoldingsState {
  stateType: 'total_holdings';
  snapshotId: string;
  recordSetHash: string;
  asOf?: ISODate;
  generatedAt: ISODateTime;
  hardFactOnly: true;
  insufficientData: boolean;
  positionCount: number;
  positions: TotalHoldingsPosition[];
  quantityTotalsByCurrency: Record<string, number>;
  valuationTotalsByCurrency: Record<string, number>;
  sourceRunIds: string[];
}

export interface NetWorthState {
  stateType: 'net_worth';
  generatedAt: ISODateTime;
  asOf?: ISODate;
  hardFactOnly: true;
  insufficientData: boolean;
  holdingsValuationTotalsByCurrency: Record<string, number>;
  cashTotalsByCurrency?: Record<string, number>;
  netWorthTotalsByCurrency?: Record<string, number>;
  notes: string[];
}
