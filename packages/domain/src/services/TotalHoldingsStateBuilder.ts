import type { PortfolioRepository } from '../repositories';
import type { PortfolioImportRun, ProviderHoldingRecord, TotalHoldingsPosition, TotalHoldingsState } from '../types';
import { aggregateHoldingLots } from './aggregateHoldingLots';

export class TotalHoldingsStateBuilder {
  constructor(private readonly repository: PortfolioRepository) {}

  // NOTE: When API integrations are present, `apiIntegrationIds` MUST be passed so that
  // source-preference logic can exclude CSV duplicates. Omitting it silently falls back to
  // "no preference", which would resurface the net-worth doubling bug. Resolution is enforced
  // by FinancialStateApi, but callers that bypass it (e.g. direct test or future code) must
  // pass apiIntegrationIds explicitly. Consider moving resolution inside build() at R5.
  async build(params?: { providerId?: string; accountId?: string; apiIntegrationIds?: ReadonlySet<string> }): Promise<TotalHoldingsState> {
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

    const afterEligibility = records.filter((record) => isRecordEligible(record, validRuns));
    const eligible = params?.accountId
      ? afterEligibility.filter((record) => record.accountId === params.accountId)
      : afterEligibility;

    const groupedByKey = new Map<string, ProviderHoldingRecord[]>();
    for (const record of eligible) {
      const key = positionKey(record);
      const existing = groupedByKey.get(key);
      if (existing) {
        existing.push(record);
      } else {
        groupedByKey.set(key, [record]);
      }
    }

    const apiIntegrationIds = params?.apiIntegrationIds;
    const lotsByKey = new Map<string, ProviderHoldingRecord[]>();
    for (const [key, lots] of groupedByKey) {
      const filtered = apiIntegrationIds && apiIntegrationIds.size > 0
        ? applySourcePreference(lots, apiIntegrationIds)
        : lots;
      lotsByKey.set(key, filtered);
    }

    const positions = Array.from(lotsByKey.entries())
      .map(([key, lots]) => aggregatePosition(key, lots))
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

      for (const runId of position.sourceImportRunIds) {
        sourceRunIdSet.add(runId);
      }

      if (!asOf || position.actionDate > asOf) {
        asOf = position.actionDate;
      }
    }

    const allRecordIds = positions.flatMap((p) => p.sourceRecordIds);
    const recordSetHash = hashRecordSet(allRecordIds);

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

// NOTE (R8 limitation): positionKey is not account-scoped — it groups by (providerId, securityId)
// across all accounts. An API record from Account A wins for a security even when Account B has a
// CSV lot for the same security. This is intentional for R8 (single-account assumed). Must be
// revisited when multi-account cross-broker support is added.
function positionKey(record: ProviderHoldingRecord): string {
  return `${record.providerId}:${record.securityId}`;
}

function aggregatePosition(key: string, lots: ProviderHoldingRecord[]): TotalHoldingsPosition {
  const first = lots[0];
  const agg = aggregateHoldingLots(lots);

  const sourceRecordIds: string[] = [];
  const sourceRunIdSet = new Set<string>();
  const accountIdSet = new Set<string>();
  for (const lot of lots) {
    sourceRecordIds.push(lot.id);
    if (lot.importRunId) {
      sourceRunIdSet.add(lot.importRunId);
    }
    if (lot.accountId) {
      accountIdSet.add(lot.accountId);
    }
  }

  // NOTE (R8 limitation): securityName is taken from the first record in the group, which is
  // non-deterministic for CSV lots (order not guaranteed). The API path is fine — API records
  // always carry the authoritative hebName. For CSV-only positions, name may vary across imports.
  // Acceptable for R8; address when stable sort or explicit name priority is needed.
  return {
    key,
    providerId: first.providerId,
    securityId: first.securityId,
    securityName: first.securityName,
    currency: first.currency,
    quantity: agg.totalQuantity,
    costBasis: agg.weightedAvgCostBasis,
    totalCost: agg.totalCost,
    currentPrice: agg.latestCurrentPrice,
    actionDate: agg.latestActionDate,
    lotCount: lots.length,
    sourceRecordIds,
    sourceImportRunIds: Array.from(sourceRunIdSet).sort(),
    accountIds: Array.from(accountIdSet).sort(),
  };
}

/**
 * Source-preference filter: if any record in a group comes from an API integration,
 * return only the API-sourced records. CSV records are used only as fallback when
 * no API record exists for the group.
 */
function applySourcePreference(
  lots: ProviderHoldingRecord[],
  apiIntegrationIds: ReadonlySet<string>,
): ProviderHoldingRecord[] {
  const apiLots = lots.filter((lot) => apiIntegrationIds.has(lot.providerIntegrationId));
  return apiLots.length > 0 ? apiLots : lots;
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
