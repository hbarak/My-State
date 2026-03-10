import type { PortfolioRepository } from '../repositories';
import type { PortfolioImportRun, ProviderHoldingRecord, TotalHoldingsPosition, TotalHoldingsState } from '../types';

export class TotalHoldingsStateBuilder {
  constructor(private readonly repository: PortfolioRepository) {}

  async build(params?: { providerId?: string }): Promise<TotalHoldingsState> {
    const records = params?.providerId
      ? await this.repository.listHoldingRecordsByProvider(params.providerId)
      : await this.repository.listHoldingRecords();

    const runs = params?.providerId
      ? await this.repository.listImportRunsByProvider(params.providerId)
      : await this.repository.listImportRuns();

    const validRuns = new Map(
      runs
        .filter((run) => run.status === 'success' && !run.undoneAt)
        .map((run) => [run.id, run]),
    );

    const eligible = records.filter((record) => isRecordEligible(record, validRuns));

    const latestByKey = new Map<string, ProviderHoldingRecord>();
    for (const record of eligible) {
      const key = positionKey(record);
      const existing = latestByKey.get(key);
      if (!existing) {
        latestByKey.set(key, record);
        continue;
      }

      if (isNewer(record, existing, validRuns)) {
        latestByKey.set(key, record);
      }
    }

    const positions = Array.from(latestByKey.values())
      .map((record) => toPosition(record))
      .sort((a, b) => a.key.localeCompare(b.key));

    const quantityTotalsByCurrency: Record<string, number> = {};
    const valuationTotalsByCurrency: Record<string, number> = {};
    const sourceRunIdSet = new Set<string>();
    let asOf: string | undefined;
    let insufficientData = false;

    for (const position of positions) {
      quantityTotalsByCurrency[position.currency] =
        (quantityTotalsByCurrency[position.currency] ?? 0) + position.quantity;

      if (typeof position.currentPrice === 'number') {
        valuationTotalsByCurrency[position.currency] =
          (valuationTotalsByCurrency[position.currency] ?? 0) + position.quantity * position.currentPrice;
      } else {
        insufficientData = true;
      }

      if (position.sourceImportRunId) {
        sourceRunIdSet.add(position.sourceImportRunId);
      }

      if (!asOf || position.actionDate > asOf) {
        asOf = position.actionDate;
      }
    }

    const recordSetHash = hashRecordSet(positions.map((p) => p.sourceRecordId));

    return {
      stateType: 'total_holdings',
      snapshotId: `total_holdings:${recordSetHash}`,
      recordSetHash,
      asOf,
      generatedAt: new Date().toISOString(),
      hardFactOnly: true,
      insufficientData,
      positionCount: positions.length,
      positions,
      quantityTotalsByCurrency,
      valuationTotalsByCurrency,
      sourceRunIds: Array.from(sourceRunIdSet).sort(),
    };
  }
}

function isRecordEligible(
  record: ProviderHoldingRecord,
  validRuns: Map<string, PortfolioImportRun>,
): boolean {
  if (record.deletedAt) return false;
  if (!record.importRunId) return false;
  return validRuns.has(record.importRunId);
}

function positionKey(record: ProviderHoldingRecord): string {
  return `${record.providerId}:${record.securityId}`;
}

function isNewer(
  candidate: ProviderHoldingRecord,
  current: ProviderHoldingRecord,
  validRuns: Map<string, PortfolioImportRun>,
): boolean {
  if (candidate.actionDate > current.actionDate) return true;
  if (candidate.actionDate < current.actionDate) return false;

  const candidateRun = candidate.importRunId ? validRuns.get(candidate.importRunId) : undefined;
  const currentRun = current.importRunId ? validRuns.get(current.importRunId) : undefined;

  if (candidateRun?.startedAt && currentRun?.startedAt) {
    if (candidateRun.startedAt > currentRun.startedAt) return true;
    if (candidateRun.startedAt < currentRun.startedAt) return false;
  }

  return candidate.updatedAt > current.updatedAt;
}

function toPosition(record: ProviderHoldingRecord): TotalHoldingsPosition {
  return {
    key: positionKey(record),
    providerId: record.providerId,
    securityId: record.securityId,
    securityName: record.securityName,
    currency: record.currency,
    quantity: record.quantity,
    costBasis: record.costBasis,
    currentPrice: record.currentPrice,
    actionDate: record.actionDate,
    sourceRecordId: record.id,
    sourceImportRunId: record.importRunId,
  };
}

function hashRecordSet(recordIds: string[]): string {
  const input = [...recordIds].sort().join('|');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}
