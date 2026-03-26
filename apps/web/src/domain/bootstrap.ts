import { LocalPortfolioRepository } from '../../../../packages/domain/src/repositories/portfolioRepository';
import { PortfolioImportService } from '../../../../packages/domain/src/services/PortfolioImportService';
import { FinancialStateService } from '../../../../packages/domain/src/services/FinancialStateService';
import { SecurityLotQueryService } from '../../../../packages/domain/src/services/SecurityLotQueryService';
import { MarketPriceService } from '../../../../packages/domain/src/services/MarketPriceService';
import { TickerResolverService } from '../../../../packages/domain/src/services/TickerResolverService';
import { PortfolioPriceEnricher } from '../../../../packages/domain/src/services/PortfolioPriceEnricher';
import { AccountService, ensureDefaultAccounts } from '../../../../packages/domain/src/services/AccountService';
import { ImportRunQueryService } from '../../../../packages/domain/src/services/ImportRunQueryService';
import { PsagotApiClient } from '../../../../packages/domain/src/services/PsagotApiClient';
import { PsagotApiImportHandler } from '../../../../packages/domain/src/services/PsagotApiImportHandler';
import { PsagotApiSyncService } from '../../../../packages/domain/src/services/PsagotApiSyncService';
import { BrowserLocalStorageJsonStore } from '../../../../packages/domain/src/stores/jsonStores';
import { TelemetryService, ConsoleTelemetrySink } from '../../../../packages/domain/src/telemetry';
import type { HttpPort } from '../../../../packages/domain/src/ports/HttpPort';
import { YahooFinancePriceFetcher } from '../adapters/YahooFinancePriceFetcher';
import { YahooFinanceTickerSearcher } from '../adapters/YahooFinanceTickerSearcher';

const store = new BrowserLocalStorageJsonStore('my-stocks:web:');
const repository = new LocalPortfolioRepository(store);
const telemetry = new TelemetryService(new ConsoleTelemetrySink());

const priceFetcher = new YahooFinancePriceFetcher();
const tickerSearcher = new YahooFinanceTickerSearcher();
const tickerResolver = new TickerResolverService(repository, tickerSearcher);
const priceService = new MarketPriceService(priceFetcher);
const priceEnricher = new PortfolioPriceEnricher(tickerResolver, priceService);
const financialStateService = new FinancialStateService(repository, priceEnricher);

const fetchHttpAdapter: HttpPort = {
  async request(req) {
    const init: RequestInit = {
      method: req.method,
      headers: req.headers,
    };
    if (req.body !== undefined) {
      init.body = JSON.stringify(req.body);
    }
    const controller = new AbortController();
    const timeoutId = req.timeoutMs
      ? setTimeout(() => controller.abort(), req.timeoutMs)
      : undefined;
    init.signal = controller.signal;

    try {
      const res = await fetch(req.url, init);
      const body = await res.json();
      return { status: res.status, body };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
};

const psagotApiClient = new PsagotApiClient(fetchHttpAdapter);
const psagotApiImportHandler = new PsagotApiImportHandler();
const accountService = new AccountService(repository);
const psagotApiSyncService = new PsagotApiSyncService(repository, accountService, psagotApiImportHandler);

export const domain = {
  repository,
  importService: new PortfolioImportService(repository, telemetry),
  financialStateService,
  securityLotQueryService: new SecurityLotQueryService(repository),
  importRunQueryService: new ImportRunQueryService(repository),
  accountService,
  psagotApiClient,
  psagotApiSyncService,
  tickerResolver,
};

export const SPRINT1_PROVIDER_ID = 'provider-web-demo';
export const SPRINT1_TRADES_INTEGRATION_ID = 'integration-web-demo-trades-csv';
export const SPRINT1_HOLDINGS_INTEGRATION_ID = 'integration-web-demo-holdings-csv';
export const PSAGOT_API_INTEGRATION_ID = 'psagot-api-holdings';

export async function ensureSprintOnePreviewSetup(): Promise<void> {
  const now = nowIso();

  // Ensure default accounts exist for backward compatibility
  await ensureDefaultAccounts(repository);

  await repository.upsertProvider({
    id: SPRINT1_PROVIDER_ID,
    name: 'Web Demo Broker',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertIntegration({
    id: SPRINT1_TRADES_INTEGRATION_ID,
    providerId: SPRINT1_PROVIDER_ID,
    kind: 'document',
    dataDomain: 'trades',
    communicationMethod: 'document_csv',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'web.demo.trades.csv.v1',
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertIntegration({
    id: SPRINT1_HOLDINGS_INTEGRATION_ID,
    providerId: SPRINT1_PROVIDER_ID,
    kind: 'document',
    dataDomain: 'holdings',
    communicationMethod: 'document_csv',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'web.demo.holdings.csv.v1',
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertMappingProfile({
    id: 'profile-web-demo-trades-v1',
    providerId: SPRINT1_PROVIDER_ID,
    providerIntegrationId: SPRINT1_TRADES_INTEGRATION_ID,
    name: 'Web Demo Trades CSV v1',
    version: 1,
    isActive: true,
    inputFormat: 'csv',
    fieldMappings: {
      accountId: 'Account',
      symbol: 'Symbol',
      side: 'Side',
      quantity: 'Qty',
      price: 'Price',
      fees: 'Fees',
      currency: 'Currency',
      tradeAt: 'TradeDate',
      externalTradeId: 'ExternalTradeId',
      note: 'Note',
    },
    requiredCanonicalFields: ['accountId', 'symbol', 'side', 'quantity', 'price', 'tradeAt'],
    optionalCanonicalFields: ['fees', 'currency', 'externalTradeId', 'note'],
    valueMappings: {
      side: {
        BUY: 'buy',
        SELL: 'sell',
      },
    },
    createdAt: now,
    updatedAt: now,
  });

  // R4 shortcut: API integration shares demo provider. Replace with dedicated
  // Psagot provider when multi-broker support is added (R5).
  await repository.upsertIntegration({
    id: PSAGOT_API_INTEGRATION_ID,
    providerId: SPRINT1_PROVIDER_ID,
    kind: 'api',
    dataDomain: 'holdings',
    communicationMethod: 'api_pull',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'psagot-api-v2',
    isEnabled: true,
    notes: 'Psagot trade1.psagot.co.il REST API — manual sync with SMS OTP',
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertMappingProfile({
    id: 'profile-web-demo-holdings-v1',
    providerId: SPRINT1_PROVIDER_ID,
    providerIntegrationId: SPRINT1_HOLDINGS_INTEGRATION_ID,
    name: 'Web Demo Holdings CSV v1 (Hebrew)',
    version: 1,
    isActive: true,
    inputFormat: 'csv',
    fieldMappings: {
      securityId: 'מספר ני"ע',
      securityName: 'שם נייר',
      actionType: 'סוג פעולה',
      quantity: 'כמות',
      costBasis: 'שער עלות למס',
      currency: 'מטבע',
      actionDate: 'תאריך ביצוע הפעולה',
      currentPrice: 'מחיר/שער',
    },
    requiredCanonicalFields: ['securityId', 'securityName', 'actionType', 'quantity', 'costBasis', 'currency', 'actionDate'],
    optionalCanonicalFields: ['currentPrice'],
    parsingRules: { monetaryUnit: 'agorot' },
    createdAt: now,
    updatedAt: now,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}
