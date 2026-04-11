import {
  LocalPortfolioRepository,
  PortfolioImportService,
  FinancialStateService,
  SecurityLotQueryService,
  MarketPriceService,
  TickerResolverService,
  PortfolioPriceEnricher,
  AccountService,
  ensureDefaultAccounts,
  ImportRunQueryService,
  PsagotApiImportHandler,
  PsagotApiSyncService,
  TelemetryService,
  ConsoleTelemetrySink,
  IsraeliSecurityLookupImpl,
  PSAGOT_PROVIDER_ID,
  PSAGOT_PROVIDER_CAPABILITIES,
  CSV_PROVIDER_CAPABILITIES,
} from '@my-stocks/domain';
import type { HttpPort, PortfolioRepository } from '@my-stocks/domain';
import { BrowserLocalStorageJsonStore, PsagotApiClient, SupabasePortfolioRepository } from '@my-stocks/infra';
import { EodhdPriceFetcher } from '../adapters/EodhdPriceFetcher';
import { EodhdTickerSearcher } from '../adapters/EodhdTickerSearcher';
import { MayaPriceFetcher } from '../adapters/MayaPriceFetcher';
import { FanOutPriceFetcher, isTaseNumericId } from '../adapters/FanOutPriceFetcher';
import { PsagotSessionStore } from '../adapters/PsagotSessionStore';
import { PsagotPriceFetcher } from '../adapters/PsagotPriceFetcher';
import { supabase } from '../lib/supabaseClient';

export const isMockMode = import.meta.env.VITE_MOCK_API === 'true';

const repository: PortfolioRepository = isMockMode
  ? new LocalPortfolioRepository(new BrowserLocalStorageJsonStore('my-stocks:web:'))
  : new SupabasePortfolioRepository(supabase);
const telemetry = new TelemetryService(new ConsoleTelemetrySink());

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

const psagotApiClient = new PsagotApiClient(fetchHttpAdapter, '/api/psagot');
const psagotApiImportHandler = new PsagotApiImportHandler();
const accountService = new AccountService(repository);
const psagotApiSyncService = new PsagotApiSyncService(repository, accountService, psagotApiImportHandler);

export const psagotSessionStore = new PsagotSessionStore();
const psagotPriceFetcher = new PsagotPriceFetcher(psagotApiClient, psagotSessionStore);

const eodhdFetcher = new EodhdPriceFetcher();
const mayaFetcher = new MayaPriceFetcher();

// Route-based price fetcher:
//   1. Psagot equity numbers (known from last sync) — exclusive, direct fetchMarketRates
//   2. TASE all-digit IDs (not in Psagot set) — exclusive, Maya API
//   3. Symbol tickers — non-exclusive: Psagot (via autoComplete) + EODHD in parallel
// EODHD is the fallback for anything not exclusively claimed or when routes fail.
export const priceFetcher = new FanOutPriceFetcher(
  [
    {
      name: 'psagot-equity',
      // canHandle returns false by default; updateKnownTickers() populates the set
      // routeCanHandle() in FanOutPriceFetcher checks knownTickers first
      canHandle: () => false,
      fetcher: psagotPriceFetcher,
      exclusive: true,
    },
    {
      name: 'maya',
      canHandle: isTaseNumericId,
      fetcher: mayaFetcher,
      exclusive: true,
    },
    {
      name: 'psagot-symbol',
      canHandle: (ticker) => !isTaseNumericId(ticker),
      fetcher: psagotPriceFetcher,
      exclusive: false,
    },
  ],
  eodhdFetcher,
);

const tickerSearcher = new EodhdTickerSearcher();
const israeliLookup = new IsraeliSecurityLookupImpl();
const tickerResolver = new TickerResolverService(repository, tickerSearcher, israeliLookup);
const priceService = new MarketPriceService(priceFetcher);
const priceEnricher = new PortfolioPriceEnricher(tickerResolver, priceService);
const financialStateService = new FinancialStateService(repository, priceEnricher);

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
  getProvenanceForSecurity: (securityId: string) => repository.getProvenanceForSecurity(securityId),
  deleteImportRunContribution: (runId: string) => repository.deleteImportRunContribution(runId),
  resetAllData: () => repository.resetAllData(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider / integration constants
// ─────────────────────────────────────────────────────────────────────────────

// Re-export PSAGOT_PROVIDER_ID from domain catalog so callers use the canonical constant
export { PSAGOT_PROVIDER_ID };

/** CSV-only demo provider (trades + holdings CSV imports) */
export const CSV_PROVIDER_ID = 'provider-csv-demo';
export const CSV_TRADES_INTEGRATION_ID = 'integration-csv-demo-trades';
export const CSV_HOLDINGS_INTEGRATION_ID = 'integration-csv-demo-holdings';

export const PSAGOT_API_INTEGRATION_ID = 'psagot-api-holdings';
export const PSAGOT_CSV_INTEGRATION_ID = 'psagot-csv-holdings';

// ─────────────────────────────────────────────────────────────────────────────
// Seed: CSV demo provider
// Provides trades + holdings CSV import. No auth, no account discovery.
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureCsvProviderSetup(): Promise<void> {
  const providers = await repository.getProviders();
  if (providers.some((p) => p.id === CSV_PROVIDER_ID)) return;

  const now = nowIso();

  await ensureDefaultAccounts(repository);

  await repository.upsertProvider({
    id: CSV_PROVIDER_ID,
    name: 'CSV Import',
    status: 'active',
    capabilities: CSV_PROVIDER_CAPABILITIES,
    authMethod: 'none',
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertIntegration({
    id: CSV_TRADES_INTEGRATION_ID,
    providerId: CSV_PROVIDER_ID,
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
    id: CSV_HOLDINGS_INTEGRATION_ID,
    providerId: CSV_PROVIDER_ID,
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
    id: 'profile-csv-trades-v1',
    providerId: CSV_PROVIDER_ID,
    providerIntegrationId: CSV_TRADES_INTEGRATION_ID,
    name: 'Trades CSV v1',
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
      side: { BUY: 'buy', SELL: 'sell' },
    },
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertMappingProfile({
    id: 'profile-csv-holdings-v1',
    providerId: CSV_PROVIDER_ID,
    providerIntegrationId: CSV_HOLDINGS_INTEGRATION_ID,
    name: 'Holdings CSV v1 (Hebrew)',
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

// ─────────────────────────────────────────────────────────────────────────────
// Seed: Psagot provider
// Israeli broker — holdings via API (OTP auth) and CSV export.
// Linked to the Psagot DataSource (same session).
// ─────────────────────────────────────────────────────────────────────────────

export async function ensurePsagotProviderSetup(): Promise<void> {
  const providers = await repository.getProviders();
  if (providers.some((p) => p.id === PSAGOT_PROVIDER_ID)) return;

  const now = nowIso();

  await repository.upsertProvider({
    id: PSAGOT_PROVIDER_ID,
    name: 'Psagot',
    status: 'active',
    capabilities: PSAGOT_PROVIDER_CAPABILITIES,
    authMethod: 'otp_2fa',
    linkedDataSourceId: 'datasource-psagot',
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertIntegration({
    id: PSAGOT_API_INTEGRATION_ID,
    providerId: PSAGOT_PROVIDER_ID,
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

  await repository.upsertIntegration({
    id: PSAGOT_CSV_INTEGRATION_ID,
    providerId: PSAGOT_PROVIDER_ID,
    kind: 'document',
    dataDomain: 'holdings',
    communicationMethod: 'document_csv',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'psagot-csv-holdings-v1',
    isEnabled: true,
    notes: 'Psagot holdings CSV export (Hebrew columns, agorot monetary unit)',
    createdAt: now,
    updatedAt: now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy shim — preserves backward-compat for any code still referencing
// SPRINT1_PROVIDER_ID. Points to the CSV provider which replaces it.
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use CSV_PROVIDER_ID */
export const SPRINT1_PROVIDER_ID = CSV_PROVIDER_ID;
/** @deprecated Use CSV_TRADES_INTEGRATION_ID */
export const SPRINT1_TRADES_INTEGRATION_ID = CSV_TRADES_INTEGRATION_ID;
/** @deprecated Use CSV_HOLDINGS_INTEGRATION_ID */
export const SPRINT1_HOLDINGS_INTEGRATION_ID = CSV_HOLDINGS_INTEGRATION_ID;

// ─────────────────────────────────────────────────────────────────────────────
// Combined setup — call on app start
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureSprintOnePreviewSetup(): Promise<void> {
  await ensureCsvProviderSetup();
  await ensurePsagotProviderSetup();
}

function nowIso(): string {
  return new Date().toISOString();
}
