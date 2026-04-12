import type { IBPosition, ProviderHoldingRecord } from '../types';
import { makeId, nowIso } from '../utils/idUtils';

interface MapPositionsParams {
  readonly positions: readonly IBPosition[];
  readonly providerId: string;
  readonly providerIntegrationId: string;
  readonly accountId: string;
  readonly importRunId: string;
}

/**
 * Maps IB Client Portal positions to domain ProviderHoldingRecord.
 *
 * Filters:
 * - Only STK (stocks) — skips options, futures, bonds, cash
 * - Only non-zero positions — skips closed positions
 */
export class IBApiImportHandler {
  readonly dataDomain = 'holdings' as const;
  readonly communicationMethod = 'api_pull' as const;

  mapPositionsToHoldingRecords(params: MapPositionsParams): ProviderHoldingRecord[] {
    const now = nowIso();
    const today = now.slice(0, 10);

    return params.positions
      .filter((p) => this.isValidPosition(p))
      .map((position): ProviderHoldingRecord => ({
        id: makeId('ib_holding'),
        providerId: params.providerId,
        providerIntegrationId: params.providerIntegrationId,
        accountId: params.accountId,
        importRunId: params.importRunId,
        securityId: String(position.conid),
        securityName: position.fullName ?? position.contractDesc,
        actionType: 'hold',
        quantity: position.position,
        costBasis: position.avgCost,
        currency: position.currency,
        actionDate: today,
        currentPrice: position.mktPrice,
        createdAt: now,
        updatedAt: now,
      }));
  }

  private isValidPosition(position: IBPosition): boolean {
    if (position.assetClass !== 'STK') return false;
    if (position.position === 0) return false;
    return true;
  }
}
