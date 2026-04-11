import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';

/**
 * Composite PriceFetcher that routes tickers to the correct data source:
 *
 *   1. Provider-known tickers (explicit set) → providerFetcher only
 *   2. All-digit strings (e.g. "1183441") → mayaFetcher (TASE mutual fund IDs)
 *   3. Non-numeric tickers (e.g. "DLEKG.TA", "AAPL"):
 *      - If providerFetcher is set: sent to BOTH providerFetcher and eodhdFetcher in parallel.
 *        Provider result wins if successful; EODHD result is the fallback.
 *      - Otherwise: eodhdFetcher only
 *
 * This allows the provider (e.g. Psagot) to lazily resolve unknown symbol tickers
 * via its autoComplete endpoint without the fan-out needing to know the equity numbers
 * in advance. Provider errors for symbol tickers fall through to EODHD automatically.
 *
 * Explicit providerTickers (equity numbers from sync) always go to provider only,
 * not to EODHD — they are known-good and EODHD wouldn't know them anyway.
 */
export class FanOutPriceFetcher implements PriceFetcher {
  private providerTickers: ReadonlySet<string> = new Set();

  constructor(
    private readonly eodhdFetcher: PriceFetcher,
    private readonly mayaFetcher: PriceFetcher,
    private readonly providerFetcher?: PriceFetcher,
    providerTickers?: ReadonlySet<string>,
  ) {
    if (providerTickers) {
      this.providerTickers = providerTickers;
    }
  }

  updateProviderTickers(tickers: ReadonlySet<string>): void {
    this.providerTickers = tickers;
  }

  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    // Partition tickers into three buckets
    const providerOnlyTickers: string[] = [];  // explicit equity numbers known to provider
    const mayaTickers: string[] = [];           // all-digit TASE numeric IDs
    const symbolTickers: string[] = [];         // everything else (e.g. AAPL, DLEKG.TA)

    for (const t of tickers) {
      if (this.providerFetcher && this.providerTickers.has(t)) {
        providerOnlyTickers.push(t);
      } else if (isTaseNumericId(t)) {
        mayaTickers.push(t);
      } else {
        symbolTickers.push(t);
      }
    }

    // Symbol tickers: send to both provider and EODHD in parallel (if provider exists)
    const eodhdSymbolTickers = symbolTickers; // EODHD always gets them
    const providerSymbolTickers = this.providerFetcher ? symbolTickers : [];

    const [providerOnlyResults, providerSymbolResults, eodhdResults, mayaResults] = await Promise.all([
      providerOnlyTickers.length > 0 && this.providerFetcher
        ? this.providerFetcher.fetchPrices(providerOnlyTickers)
        : Promise.resolve<readonly PriceResult[]>([]),
      providerSymbolTickers.length > 0 && this.providerFetcher
        ? this.providerFetcher.fetchPrices(providerSymbolTickers)
        : Promise.resolve<readonly PriceResult[]>([]),
      eodhdSymbolTickers.length > 0
        ? this.eodhdFetcher.fetchPrices(eodhdSymbolTickers)
        : Promise.resolve<readonly PriceResult[]>([]),
      mayaTickers.length > 0
        ? this.mayaFetcher.fetchPrices(mayaTickers)
        : Promise.resolve<readonly PriceResult[]>([]),
    ]);

    // Fallback: explicit provider-only errors → re-route to EODHD
    const failedProviderOnlyTickers = providerOnlyResults
      .filter((r) => r.status === 'error')
      .map((r) => r.ticker);

    let providerOnlyFallbackResults: readonly PriceResult[] = [];
    if (failedProviderOnlyTickers.length > 0) {
      providerOnlyFallbackResults = await this.eodhdFetcher.fetchPrices(failedProviderOnlyTickers);
    }

    // Merge providerOnly results (with fallback)
    const fallbackMap = new Map(providerOnlyFallbackResults.map((r) => [r.ticker, r]));
    const failedSet = new Set(failedProviderOnlyTickers);
    const mergedProviderOnlyResults = providerOnlyResults.map((r) =>
      failedSet.has(r.ticker) ? (fallbackMap.get(r.ticker) ?? r) : r,
    );

    // For symbol tickers: provider wins if successful, otherwise use EODHD result
    const eodhdMap = new Map(eodhdResults.map((r) => [r.ticker, r]));
    const mergedSymbolResults: PriceResult[] = symbolTickers.map((ticker) => {
      const providerResult = providerSymbolResults.find((r) => r.ticker === ticker);
      if (providerResult?.status === 'success') return providerResult;
      return eodhdMap.get(ticker) ?? { ticker, status: 'error', error: 'not_found' };
    });

    return [...mergedProviderOnlyResults, ...mergedSymbolResults, ...mayaResults];
  }
}

/**
 * Returns true if the ticker is a TASE numeric fund ID (all digits, e.g. "1183441").
 * These are routed to the Maya TASE API instead of EODHD.
 *
 * Exported for unit testing.
 */
export function isTaseNumericId(ticker: string): boolean {
  return ticker.length > 0 && /^\d+$/.test(ticker);
}
