import type { PortfolioRepository } from '../repositories';
import type { Account, ProviderHoldingRecord } from '../types';
import { aggregateHoldingLots } from './aggregateHoldingLots';

export interface SecurityLot {
  recordId: string;
  securityId: string;
  securityName: string;
  accountId: string;
  actionType: string;
  quantity: number;
  costBasis: number;
  currency: string;
  actionDate: string;
  currentPrice?: number;
  importRunId?: string;
  fifoOrder: number;
}

export interface AccountSubtotal {
  accountId: string;
  accountName: string;
  quantity: number;
  totalCost: number;
  weightedAvgCostBasis: number;
  lotCount: number;
  lots: SecurityLot[];
}

export interface SecurityPosition {
  securityId: string;
  securityName: string;
  currency: string;
  totalQuantity: number;
  totalCost: number;
  weightedAvgCostBasis: number;
  currentPrice?: number;
  unrealizedGain?: number;
  lotCount: number;
  lots: SecurityLot[];
  accountBreakdown: AccountSubtotal[];
}

export interface PortfolioLotView {
  providerId: string;
  generatedAt: string;
  positionCount: number;
  positions: SecurityPosition[];
}

export class SecurityLotQueryService {
  constructor(private readonly repository: PortfolioRepository) {}

  async getPortfolioLots(params: { providerId: string }): Promise<PortfolioLotView> {
    const records = await this.repository.listHoldingRecordsByProvider(params.providerId);
    const runs = await this.repository.listImportRunsByProvider(params.providerId);
    const accounts = await this.repository.listAccountsByProvider(params.providerId);

    const accountNameById = new Map<string, string>(
      accounts.map((a) => [a.id, a.name]),
    );

    const validRunIds = new Set(
      runs
        .filter((run) => run.status === 'success' && !run.undoneAt)
        .map((run) => run.id),
    );

    const eligible = records.filter((r) => !r.deletedAt && r.importRunId && validRunIds.has(r.importRunId));

    const grouped = groupBySecurityId(eligible);
    const positions = Array.from(grouped.entries())
      .map(([securityId, lots]) => buildPosition(securityId, lots, accountNameById))
      .sort((a, b) => a.securityId.localeCompare(b.securityId));

    return {
      providerId: params.providerId,
      generatedAt: new Date().toISOString(),
      positionCount: positions.length,
      positions,
    };
  }

  async getSecurityLots(params: { providerId: string; securityId: string }): Promise<SecurityPosition | null> {
    const view = await this.getPortfolioLots({ providerId: params.providerId });
    return view.positions.find((p) => p.securityId === params.securityId) ?? null;
  }
}

function groupBySecurityId(records: ProviderHoldingRecord[]): Map<string, ProviderHoldingRecord[]> {
  const map = new Map<string, ProviderHoldingRecord[]>();
  for (const record of records) {
    const existing = map.get(record.securityId);
    if (existing) {
      existing.push(record);
    } else {
      map.set(record.securityId, [record]);
    }
  }
  return map;
}

function buildPosition(
  securityId: string,
  records: ProviderHoldingRecord[],
  accountNameById: Map<string, string>,
): SecurityPosition {
  const sorted = [...records].sort((a, b) => {
    const dateCmp = a.actionDate.localeCompare(b.actionDate);
    if (dateCmp !== 0) return dateCmp;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const lots: SecurityLot[] = sorted.map((r, idx) => ({
    recordId: r.id,
    securityId: r.securityId,
    securityName: r.securityName,
    accountId: r.accountId ?? 'default',
    actionType: r.actionType,
    quantity: r.quantity,
    costBasis: r.costBasis,
    currency: r.currency,
    actionDate: r.actionDate,
    currentPrice: r.currentPrice,
    importRunId: r.importRunId,
    fifoOrder: idx + 1,
  }));

  const first = sorted[0];
  const agg = aggregateHoldingLots(records);

  let unrealizedGain: number | undefined;
  if (typeof agg.latestCurrentPrice === 'number' && agg.totalQuantity > 0) {
    unrealizedGain = (agg.latestCurrentPrice * agg.totalQuantity) - agg.totalCost;
  }

  const accountBreakdown = buildAccountBreakdown(lots, accountNameById);

  return {
    securityId,
    securityName: first.securityName,
    currency: first.currency,
    totalQuantity: agg.totalQuantity,
    totalCost: agg.totalCost,
    weightedAvgCostBasis: agg.weightedAvgCostBasis,
    currentPrice: agg.latestCurrentPrice,
    unrealizedGain,
    lotCount: lots.length,
    lots,
    accountBreakdown,
  };
}

function buildAccountBreakdown(
  lots: SecurityLot[],
  accountNameById: Map<string, string>,
): AccountSubtotal[] {
  const grouped = new Map<string, SecurityLot[]>();
  for (const lot of lots) {
    const existing = grouped.get(lot.accountId);
    if (existing) {
      existing.push(lot);
    } else {
      grouped.set(lot.accountId, [lot]);
    }
  }

  return Array.from(grouped.entries())
    .map(([accountId, accountLots]) => {
      let totalQuantity = 0;
      let totalCost = 0;
      for (const lot of accountLots) {
        totalQuantity += lot.quantity;
        totalCost += lot.costBasis * lot.quantity;
      }

      return {
        accountId,
        accountName: accountNameById.get(accountId) ?? accountId,
        quantity: totalQuantity,
        totalCost,
        weightedAvgCostBasis: totalQuantity > 0 ? totalCost / totalQuantity : 0,
        lotCount: accountLots.length,
        lots: accountLots,
      };
    })
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
}
