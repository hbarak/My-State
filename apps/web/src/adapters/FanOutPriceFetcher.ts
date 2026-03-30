import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';

/**
 * Composite PriceFetcher that routes tickers to the correct data source:
 *
 *   - All-digit strings (e.g. "1183441") → mayaFetcher (TASE mutual fund IDs)
 *   - Everything else (e.g. "DLEKG.TA", "AAPL") → eodhdFetcher (exchange tickers)
 *
 * Both sources are called in parallel. Results are merged and returned in the
 * same order contract as a single PriceFetcher (each result carries its ticker).
 *
 * This is the only place that knows about the two-source routing rule.
 * Neither MarketPriceService nor any domain code is aware of the split.
 */
export class FanOutPriceFetcher implements PriceFetcher {
  constructor(
    private readonly eodhdFetcher: PriceFetcher,
    private readonly mayaFetcher: PriceFetcher,
  ) {}

  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    const eodhdTickers = tickers.filter((t) => !isTaseNumericId(t));
    const mayaTickers = tickers.filter(isTaseNumericId);

    const [eodhdResults, mayaResults] = await Promise.all([
      eodhdTickers.length > 0 ? this.eodhdFetcher.fetchPrices(eodhdTickers) : Promise.resolve<readonly PriceResult[]>([]),
      mayaTickers.length > 0 ? this.mayaFetcher.fetchPrices(mayaTickers) : Promise.resolve<readonly PriceResult[]>([]),
    ]);

    return [...eodhdResults, ...mayaResults];
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
