import { CurrencyCode, ISODate, ISODateTime } from './common';
import type { PortfolioImportRun } from './portfolio';

export interface ImportRunSummary {
  run: PortfolioImportRun;
  rawRowCounts: { total: number; valid: number; invalid: number; duplicate: number };
  lotCount: number;
  tradeCount: number;
}

export interface ImportRunListItem {
  /** The full import run record. */
  readonly run: PortfolioImportRun;
  /** Source type derived from the ProviderIntegration's communicationMethod. */
  readonly sourceType: 'csv' | 'api';
  /** Account name for display (resolved from Account entity, falls back to accountId). */
  readonly accountLabel: string;
  /** Row counts (total, valid, invalid, duplicate). Null if raw rows not yet stored (legacy runs). */
  readonly rawRowCounts: { total: number; valid: number; invalid: number; duplicate: number } | null;
}

export interface TotalHoldingsPosition {
  key: string;
  providerId: string;
  securityId: string;
  securityName: string;
  currency: CurrencyCode;
  /** Total quantity across all lots for this security */
  quantity: number;
  /** Weighted average cost per unit (totalCost / quantity) */
  costBasis: number;
  /** Total cost across all lots (sum of costBasis * quantity per lot) */
  totalCost: number;
  currentPrice?: number;
  actionDate: ISODate;
  /** Number of lots that make up this position */
  lotCount: number;
  /** IDs of all lot records included in this position */
  sourceRecordIds: string[];
  sourceImportRunIds: string[];
  /** All account IDs contributing lots to this position */
  accountIds: string[];
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
