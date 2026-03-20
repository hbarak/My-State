import { describe, expect, it } from 'vitest';
import { LocalPortfolioRepository, type JsonStore } from '../src/repositories';
import { PortfolioImportService } from '../src/services/PortfolioImportService';
import { TotalHoldingsStateBuilder } from '../src/services/TotalHoldingsStateBuilder';
import { TickerResolverService } from '../src/services/TickerResolverService';
import { MarketPriceService } from '../src/services/MarketPriceService';
import { PortfolioPriceEnricher } from '../src/services/PortfolioPriceEnricher';
import type { TickerSearcher } from '../src/ports/TickerSearcher';
import type { PriceFetcher, PriceResult } from '../src/services/MarketPriceService';
import type { ProviderIntegration, ProviderMappingProfile } from '../src/types';

class InMemoryStore implements JsonStore {
  private readonly mem = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.mem.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.mem.set(key, value);
  }
}

const PROVIDER_ID = 'provider-psagot';
const INTEGRATION_ID = 'integration-psagot-holdings';

function makeIntegrationFixture(opts: {
  searchResults: Record<string, string | null>;
  priceResults: PriceResult[];
  priceFetcherThrows?: Error;
}) {
  const store = new InMemoryStore();
  const repository = new LocalPortfolioRepository(store);
  const importService = new PortfolioImportService(repository);
  const holdingsBuilder = new TotalHoldingsStateBuilder(repository);

  const searcher: TickerSearcher = {
    async searchTicker(securityName: string): Promise<string | null> {
      return opts.searchResults[securityName] ?? null;
    },
  };

  const fetcher: PriceFetcher = {
    async fetchPrices(_tickers: readonly string[]): Promise<readonly PriceResult[]> {
      if (opts.priceFetcherThrows) throw opts.priceFetcherThrows;
      return opts.priceResults;
    },
  };

  const tickerResolver = new TickerResolverService(repository, searcher);
  const priceService = new MarketPriceService(fetcher);
  const enricher = new PortfolioPriceEnricher(tickerResolver, priceService);

  const now = new Date().toISOString();

  const integration: ProviderIntegration = {
    id: INTEGRATION_ID,
    providerId: PROVIDER_ID,
    kind: 'document',
    dataDomain: 'holdings',
    communicationMethod: 'document_csv',
    syncMode: 'manual',
    direction: 'ingest',
    adapterKey: 'psagot.holdings.csv.v1',
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  };

  const profile: ProviderMappingProfile = {
    id: 'profile-psagot-v1',
    providerId: PROVIDER_ID,
    providerIntegrationId: INTEGRATION_ID,
    name: 'Psagot Holdings CSV v1 (Hebrew)',
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
  };

  async function seed() {
    await repository.upsertProvider({
      id: PROVIDER_ID,
      name: 'Psagot',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    await repository.upsertIntegration(integration);
    await repository.upsertMappingProfile(profile);
  }

  return { repository, importService, holdingsBuilder, enricher, seed };
}

const ILS_CSV = [
  'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","69,058.60",ש"ח,31/07/2025,"97,410.00"',
  '604611,לאומי,העברה חיצונית לח-ן,"10.00","30.00",ש"ח,01/08/2025,"35.00"',
].join('\n');

const MULTI_CURRENCY_CSV = [
  'מספר ני"ע,שם נייר,סוג פעולה,כמות,שער עלות למס,מטבע,תאריך ביצוע הפעולה,מחיר/שער',
  '1084128,דלק קבוצה,העברה חיצונית לח-ן,"5.00","69,058.60",ש"ח,31/07/2025,"97,410.00"',
  '8888888,Apple Inc,העברה חיצונית לח-ן,"20.00","150.00",דולר,01/08/2025,"185.00"',
].join('\n');

describe('Price enrichment integration tests (S2-DEV-04)', () => {
  it('happy path: import → resolve tickers → fetch prices → enrich with correct gain/loss', async () => {
    const { importService, holdingsBuilder, enricher, seed } = makeIntegrationFixture({
      searchResults: {
        'דלק קבוצה': 'DLEKG.TA',
        'לאומי': 'LUMI.TA',
      },
      priceResults: [
        { ticker: 'DLEKG.TA', status: 'success', price: 120, currency: 'ILS' },
        { ticker: 'LUMI.TA', status: 'success', price: 40, currency: 'ILS' },
      ],
    });
    await seed();

    // Import
    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'portfolio.csv',
      csvText: ILS_CSV,
    });

    // Build hard-fact holdings
    const holdings = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    expect(holdings.positionCount).toBe(2);
    expect(holdings.hardFactOnly).toBe(true);

    // Enrich with live prices
    const enriched = await enricher.enrich(holdings);
    expect(enriched.stateType).toBe('enriched_holdings');
    expect(enriched.hardFactOnly).toBe(false);
    expect(enriched.basedOn).toBe(holdings.snapshotId);
    expect(enriched.insufficientData).toBe(false);

    const delek = enriched.positions.find((p) => p.securityId === '1084128')!;
    expect(delek.priceSource).toBe('live');
    expect(delek.currentPrice).toBe(120);
    expect(delek.currentValue).toBe(600); // 5 * 120
    expect(delek.unrealizedGain).toBe(600 - delek.totalCost);

    const leumi = enriched.positions.find((p) => p.securityId === '604611')!;
    expect(leumi.priceSource).toBe('live');
    expect(leumi.currentPrice).toBe(40);
    expect(leumi.currentValue).toBe(400); // 10 * 40

    expect(enriched.priceSummary.live).toBe(2);
    expect(enriched.priceSummary.unavailable).toBe(0);
  });

  it('missing ticker: one resolves, one does not — mixed display, insufficientData = true', async () => {
    const { importService, holdingsBuilder, enricher, seed } = makeIntegrationFixture({
      searchResults: {
        'דלק קבוצה': 'DLEKG.TA',
        // לאומי not found
      },
      priceResults: [
        { ticker: 'DLEKG.TA', status: 'success', price: 120, currency: 'ILS' },
      ],
    });
    await seed();

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'portfolio.csv',
      csvText: ILS_CSV,
    });

    const holdings = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    const enriched = await enricher.enrich(holdings);

    expect(enriched.insufficientData).toBe(true);

    const delek = enriched.positions.find((p) => p.securityId === '1084128')!;
    expect(delek.priceSource).toBe('live');
    expect(delek.currentPrice).toBe(120);

    const leumi = enriched.positions.find((p) => p.securityId === '604611')!;
    // Has CSV price from import (35.00 agorot / 100 = 0.35 ILS)
    expect(leumi.priceSource).toBe('csv');
    expect(leumi.currentPrice).toBeCloseTo(0.35);

    expect(enriched.priceSummary.live).toBe(1);
    expect(enriched.priceSummary.csv).toBe(1);
  });

  it('price fetch failure: ticker resolved but Yahoo fetch fails — cost-basis-only', async () => {
    const { importService, holdingsBuilder, enricher, seed } = makeIntegrationFixture({
      searchResults: {
        'דלק קבוצה': 'DLEKG.TA',
        'לאומי': 'LUMI.TA',
      },
      priceResults: [],
      priceFetcherThrows: new Error('Yahoo Finance API unavailable'),
    });
    await seed();

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'portfolio.csv',
      csvText: ILS_CSV,
    });

    const holdings = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    const enriched = await enricher.enrich(holdings);

    expect(enriched.insufficientData).toBe(true);

    // Both positions should fall back — delek has CSV price, leumi has CSV price
    for (const pos of enriched.positions) {
      expect(pos.priceSource).toBe('csv');
      expect(pos.currentPrice).toBeDefined();
    }

    expect(enriched.priceSummary.live).toBe(0);
  });

  it('multi-currency portfolio: ILS and USD positions, totals grouped by currency', async () => {
    const { importService, holdingsBuilder, enricher, seed } = makeIntegrationFixture({
      searchResults: {
        'דלק קבוצה': 'DLEKG.TA',
        'Apple Inc': 'AAPL',
      },
      priceResults: [
        { ticker: 'DLEKG.TA', status: 'success', price: 120, currency: 'ILS' },
        { ticker: 'AAPL', status: 'success', price: 200, currency: 'USD' },
      ],
    });
    await seed();

    await importService.commitImport({
      providerId: PROVIDER_ID,
      providerIntegrationId: INTEGRATION_ID,
      sourceName: 'multi-currency.csv',
      csvText: MULTI_CURRENCY_CSV,
    });

    const holdings = await holdingsBuilder.build({ providerId: PROVIDER_ID });
    const enriched = await enricher.enrich(holdings);

    expect(enriched.insufficientData).toBe(false);

    // ILS position (currency normalized from ש"ח to ILS at import)
    const delek = enriched.positions.find((p) => p.securityId === '1084128')!;
    expect(delek.currentPrice).toBe(120);
    expect(delek.currentValue).toBe(600); // 5 * 120
    const ilsCurrency = delek.currency;

    // USD position (currency normalized from דולר to USD at import)
    // USD values must NOT be divided by 100 (agorot conversion is ILS-only)
    const apple = enriched.positions.find((p) => p.securityId === '8888888')!;
    expect(apple.totalCost).toBe(3000); // 20 * 150 (not 20 * 1.50)
    expect(apple.currentPrice).toBe(200);
    expect(apple.currentValue).toBe(4000); // 20 * 200
    const usdCurrency = apple.currency;

    // Currencies must be different
    expect(ilsCurrency).not.toBe(usdCurrency);

    // Totals are separated by currency
    expect(enriched.valuationTotalsByCurrency[ilsCurrency]).toBe(600);
    expect(enriched.valuationTotalsByCurrency[usdCurrency]).toBe(4000);

    // Cost totals also separated
    expect(enriched.costTotalsByCurrency[ilsCurrency]).toBe(delek.totalCost);
    expect(enriched.costTotalsByCurrency[usdCurrency]).toBe(apple.totalCost);

    // Gain totals separated
    expect(enriched.unrealizedGainTotalsByCurrency[ilsCurrency]).toBe(600 - delek.totalCost);
    expect(enriched.unrealizedGainTotalsByCurrency[usdCurrency]).toBe(4000 - apple.totalCost);
  });
});
