import type { PsagotBalance, PsagotSecurityInfo, ProviderHoldingRecord } from '../types';
import { makeId, nowIso } from '../utils/idUtils';

interface MapBalancesParams {
  readonly balances: readonly PsagotBalance[];
  readonly providerId: string;
  readonly providerIntegrationId: string;
  readonly accountId: string;
  readonly importRunId: string;
  readonly existingRecords: readonly ProviderHoldingRecord[];
  /** Security metadata from /V2/json2/market/table/simple, keyed by equityNumber */
  readonly securityInfoMap: ReadonlyMap<string, PsagotSecurityInfo>;
}

function resolveSecurityName(
  balance: PsagotBalance,
  securityInfo: PsagotSecurityInfo | undefined,
  existingRecords: readonly ProviderHoldingRecord[],
): string {
  if (securityInfo?.hebName) return securityInfo.hebName;
  if (securityInfo?.engName) return securityInfo.engName;

  const csvRecord = existingRecords.find((r) => r.securityId === balance.equityNumber);
  if (csvRecord) return csvRecord.securityName;

  return `Security #${balance.equityNumber}`;
}

export class PsagotApiImportHandler {
  readonly dataDomain = 'holdings' as const;
  readonly communicationMethod = 'api_pull' as const;

  mapBalancesToHoldingRecords(params: MapBalancesParams): ProviderHoldingRecord[] {
    const now = nowIso();
    const today = now.slice(0, 10);

    return params.balances
      .filter((b) => this.isValidBalance(b))
      .map((balance) => {
        const info = params.securityInfoMap.get(balance.equityNumber);
        const divisor = info?.currencyDivider ?? 1;

        return {
          id: makeId('api_holding'),
          providerId: params.providerId,
          providerIntegrationId: params.providerIntegrationId,
          accountId: params.accountId,
          importRunId: params.importRunId,
          securityId: balance.equityNumber,
          securityName: resolveSecurityName(balance, info, params.existingRecords),
          actionType: 'hold',
          quantity: balance.quantity,
          costBasis: balance.averagePrice / divisor,
          currency: balance.currencyCode,
          actionDate: today,
          currentPrice: balance.lastRate / divisor,
          createdAt: now,
          updatedAt: now,
        };
      });
  }

  private isValidBalance(balance: PsagotBalance): boolean {
    if (!balance.equityNumber) return false;
    if (balance.quantity <= 0) return false;
    if (balance.averagePrice <= 0) return false;
    return true;
  }
}
