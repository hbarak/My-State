import { CurrencyCode, ISODate, ISODateTime } from './common';
import type { PortfolioImportRun } from './portfolio';

export interface ImportRunSummary {
  run: PortfolioImportRun;
  rawRowCounts: { total: number; valid: number; invalid: number; duplicate: number };
  lotCount: number;
  tradeCount: number;
}

export interface TotalHoldingsPosition {
  key: string;
  providerId: string;
  securityId: string;
  securityName: string;
  currency: CurrencyCode;
  /** Total quantity across all lots for this security */
  quantity: number;
  /** Total cost basis across all lots (sum of costBasis * quantity per lot / total quantity = weighted avg) */
  costBasis: number;
  /** Total cost (sum of costBasis across all lots, before averaging) */
  totalCost: number;
  currentPrice?: number;
  actionDate: ISODate;
  /** Number of lots that make up this position */
  lotCount: number;
  /** IDs of all lot records included in this position */
  sourceRecordIds: string[];
  sourceImportRunIds: string[];
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
