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
  IBApiImportHandler,
  IBApiSyncService,
  TelemetryService,
  ConsoleTelemetrySink,
  IsraeliSecurityLookupImpl,
  PSAGOT_PROVIDER_ID,
  PSAGOT_PROVIDER_CAPABILITIES,
  IB_PROVIDER_ID,
  IB_PROVIDER_CAPABILITIES,
  CSV_PROVIDER_CAPABILITIES,
} from '@my-stocks/domain';
import type { HttpPort, PortfolioRepository } from '@my-stocks/domain';
import { BrowserLocalStorageJsonStore, PsagotApiClient, IBApiClient, ClientAMApiClient, SupabasePortfolioRepository } from '@my-stocks/infra';
import { EodhdPriceFetcher } from '../adapters/EodhdPriceFetcher';
import { EodhdTickerSearcher } from '../adapters/EodhdTickerSearcher';
import { MayaPriceFetcher } from '../adapters/MayaPriceFetcher';
import { FanOutPriceFetcher, isTaseNumericId } from '../adapters/FanOutPriceFetcher';
import { PsagotSessionStore } from '../adapters/PsagotSessionStore';
import { PsagotPriceFetcher } from '../adapters/PsagotPriceFetcher';
import { IBSessionStore } from '../adapters/IBSessionStore';
import { IBPriceFetcher } from '../adapters/IBPriceFetcher';
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

export const ibApiClient = new IBApiClient(fetchHttpAdapter, '/api/ib');
export const ibSessionStore = new IBSessionStore();
const ibPriceFetcher = new IBPriceFetcher(ibApiClient, ibSessionStore);
export const ibApiImportHandler = new IBApiImportHandler();
export const ibApiSyncService = new IBApiSyncService(repository, accountService, ibApiImportHandler);

// ─────────────────────────────────────────────────────────────────────────────
// ClientAM (IB Israel) — accesses same IB API via SSO cookies from clientam.com
// Shares ibSessionStore, ibApiSyncService, and price routing with the gateway path.
// ─────────────────────────────────────────────────────────────────────────────

let clientamCookies: string | undefined;

/** Set the ClientAM session cookies (pasted from browser devtools). */
export function setClientAMCookies(cookies: string): void {
  clientamCookies = cookies;
}

const clientamHttpAdapter: HttpPort = {
  async request(req) {
    const headers: Record<string, string> = { ...req.headers };
    if (clientamCookies) {
      headers['X-ClientAM-Cookies'] = clientamCookies;
    }
    return fetchHttpAdapter.request({ ...req, headers });
  },
};

export const clientamApiClient = new ClientAMApiClient(clientamHttpAdapter, '/api/clientam');

const eodhdFetcher = new EodhdPriceFetcher();
const mayaFetcher = new MayaPriceFetcher();

// Route-based price fetcher (priority order):
//   1. IB conids (known from last IB sync)    — exclusive, IB market data snapshot
//   2. Psagot equity numbers (from last sync) — exclusive, direct fetchMarketRates
//   3. TASE all-digit IDs                     — exclusive, Maya API
//   4. Symbol tickers                         — non-exclusive: Psagot + EODHD in parallel
// EODHD is the fallback for anything not exclusively claimed or when routes fail.
export const priceFetcher = new FanOutPriceFetcher(
  [
    {
      name: 'ib',
      // canHandle returns false by default; updateKnownTickers() populates the set
      canHandle: () => false,
      fetcher: ibPriceFetcher,
      exclusive: true,
    },
    {
      name: 'psagot-equity',
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
  ibApiClient,
  ibApiSyncService,
  clientamApiClient,
  tickerResolver,
  getProvenanceForSecurity: (securityId: string) => repository.getProvenanceForSecurity(securityId),
  deleteImportRunContribution: (runId: string) => repository.deleteImportRunContribution(runId),
  resetAllData: () => repository.resetAllData(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Provider / integration constants
// ─────────────────────────────────────────────────────────────────────────────

// Re-export provider IDs from domain catalog so callers use the canonical constants
export { PSAGOT_PROVIDER_ID, IB_PROVIDER_ID };

/** CSV-only demo provider (trades + holdings CSV imports) */
export const CSV_PROVIDER_ID = 'provider-csv-demo';
export const CSV_TRADES_INTEGRATION_ID = 'integration-csv-demo-trades';
export const CSV_HOLDINGS_INTEGRATION_ID = 'integration-csv-demo-holdings';

export const PSAGOT_API_INTEGRATION_ID = 'psagot-api-holdings';
export const PSAGOT_CSV_INTEGRATION_ID = 'psagot-csv-holdings';
export const IB_API_INTEGRATION_ID = 'ib-api-holdings';

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
// Seed: Interactive Brokers provider
// Accessed via local IB Client Portal Gateway (Docker or JAR).
// User authenticates via gateway browser UI — no in-app login.
// Linked to the IB DataSource (same gateway session).
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureIbProviderSetup(): Promise<void> {
  const providers = await repository.getProviders();
  if (providers.some((p) => p.id === IB_PROVIDER_ID)) return;

  const now = nowIso();

  await repository.upsertProvider({
    id: IB_PROVIDER_ID,
    name: 'Interactive Brokers',
    status: 'active',
    capabilities: IB_PROVIDER_CAPABILITIES,
    authMethod: 'gateway',
    linkedDataSourceId: 'datasource-ib',
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertIntegration({
    id: IB_API_INTEGRATION_ID,
    providerId: IB_PROVIDER_ID,
    kind: 'api',
    dataDomain: 'holdings',
    communicationMethod: 'api_pull',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'ib-cp-gateway-v1',
    isEnabled: true,
    notes: 'IB Client Portal Gateway REST API — manual sync after gateway login',
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
  await ensureIbProviderSetup();
}

function nowIso(): string {
  return new Date().toISOString();
}
