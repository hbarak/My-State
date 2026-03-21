import { LocalPortfolioRepository } from '../../../../packages/domain/src/repositories/portfolioRepository';
import { PortfolioImportService } from '../../../../packages/domain/src/services/PortfolioImportService';
import { FinancialStateService } from '../../../../packages/domain/src/services/FinancialStateService';
import { SecurityLotQueryService } from '../../../../packages/domain/src/services/SecurityLotQueryService';
import { MarketPriceService } from '../../../../packages/domain/src/services/MarketPriceService';
import { TickerResolverService } from '../../../../packages/domain/src/services/TickerResolverService';
import { PortfolioPriceEnricher } from '../../../../packages/domain/src/services/PortfolioPriceEnricher';
import { AccountService, ensureDefaultAccounts } from '../../../../packages/domain/src/services/AccountService';
import { BrowserLocalStorageJsonStore } from '../../../../packages/domain/src/stores/jsonStores';
import { TelemetryService, ConsoleTelemetrySink } from '../../../../packages/domain/src/telemetry';
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

export const domain = {
  repository,
  importService: new PortfolioImportService(repository, telemetry),
  financialStateService,
  securityLotQueryService: new SecurityLotQueryService(repository),
  accountService: new AccountService(repository),
};

export const SPRINT1_PROVIDER_ID = 'provider-web-demo';
export const SPRINT1_TRADES_INTEGRATION_ID = 'integration-web-demo-trades-csv';
export const SPRINT1_HOLDINGS_INTEGRATION_ID = 'integration-web-demo-holdings-csv';

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
