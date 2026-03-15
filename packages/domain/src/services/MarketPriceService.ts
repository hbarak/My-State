export interface PriceResult {
  readonly ticker: string;
  readonly status: 'success' | 'error';
  readonly price?: number;
  readonly currency?: string;
  readonly error?: string;
}

export interface PriceFetcher {
  fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]>;
}

export interface PriceRequest {
  readonly securityId: string;
  readonly ticker: string;
}

export interface PriceEntry {
  readonly price: number;
  readonly currency: string;
}

export interface PriceError {
  readonly securityId: string;
  readonly ticker: string;
  readonly reason: string;
}

export interface MarketPriceResult {
  readonly fetchedAt: string;
  readonly prices: ReadonlyMap<string, PriceEntry>;
  readonly errors: readonly PriceError[];
}

export class MarketPriceService {
  constructor(private readonly priceFetcher: PriceFetcher) {}

  async getPrices(requests: readonly PriceRequest[]): Promise<MarketPriceResult> {
    const fetchedAt = new Date().toISOString();

    if (requests.length === 0) {
      return { fetchedAt, prices: new Map(), errors: [] };
    }

    // Build ticker → securityIds mapping (dedup tickers)
    const tickerToSecurityIds = new Map<string, string[]>();
    for (const req of requests) {
      const existing = tickerToSecurityIds.get(req.ticker);
      if (existing) {
        existing.push(req.securityId);
      } else {
        tickerToSecurityIds.set(req.ticker, [req.securityId]);
      }
    }

    const uniqueTickers = Array.from(tickerToSecurityIds.keys());

    let fetchResults: readonly PriceResult[];
    try {
      fetchResults = await this.priceFetcher.fetchPrices(uniqueTickers);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown fetch error';
      const errors: PriceError[] = requests.map((req) => ({
        securityId: req.securityId,
        ticker: req.ticker,
        reason,
      }));
      return { fetchedAt, prices: new Map(), errors };
    }

    // Index fetcher results by ticker
    const resultByTicker = new Map<string, PriceResult>();
    for (const result of fetchResults) {
      resultByTicker.set(result.ticker, result);
    }

    // Map results back to securityIds
    const prices = new Map<string, PriceEntry>();
    const errors: PriceError[] = [];

    for (const [ticker, securityIds] of tickerToSecurityIds) {
      const result = resultByTicker.get(ticker);

      if (!result) {
        for (const securityId of securityIds) {
          errors.push({ securityId, ticker, reason: 'no_response' });
        }
      } else if (result.status === 'error') {
        for (const securityId of securityIds) {
          errors.push({ securityId, ticker, reason: result.error ?? 'unknown' });
        }
      } else if (typeof result.price !== 'number' || result.price <= 0) {
        for (const securityId of securityIds) {
          errors.push({ securityId, ticker, reason: 'invalid_price' });
        }
      } else {
        for (const securityId of securityIds) {
          prices.set(securityId, {
            price: result.price,
            currency: result.currency ?? 'USD',
          });
        }
      }
    }

    return { fetchedAt, prices, errors };
  }
}
