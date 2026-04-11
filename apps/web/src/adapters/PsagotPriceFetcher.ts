import type { PriceFetcher, PriceResult } from '../../../../packages/domain/src/services/MarketPriceService';
import type { PsagotApiClient } from '../../../../packages/infra/src/psagot/PsagotApiClient';
import type { PsagotSessionStore } from './PsagotSessionStore';

const INTER_ACCOUNT_DELAY_MS = 1100;

/**
 * PriceFetcher implementation that fetches live prices from Psagot broker
 * by reusing an active session. Calls fetchBalances() per account and
 * extracts lastRate as the current price.
 *
 * When no session is active or the session expires, returns errors for all
 * requested tickers so the FanOutPriceFetcher can fall back to EODHD.
 */
export class PsagotPriceFetcher implements PriceFetcher {
  constructor(
    private readonly client: PsagotApiClient,
    private readonly store: PsagotSessionStore,
  ) {}

  async fetchPrices(tickers: readonly string[]): Promise<readonly PriceResult[]> {
    if (tickers.length === 0) return [];

    const session = this.store.getSession();
    if (!session) {
      return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'no_session' }));
    }

    const accountKeys = this.store.getAccountKeys();
    if (accountKeys.length === 0) {
      return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'not_found' }));
    }

    // Fetch balances from all accounts, build equityNumber → price map
    const priceMap = new Map<string, { price: number; currency: string }>();

    try {
      for (let i = 0; i < accountKeys.length; i++) {
        if (i > 0) {
          await delay(INTER_ACCOUNT_DELAY_MS);
        }
        const balances = await this.client.fetchBalances(session, accountKeys[i]);
        const securityInfoMap = this.store.getSecurityInfoMap();

        for (const balance of balances) {
          const info = securityInfoMap.get(balance.equityNumber);
          const divisor = info?.currencyDivider ?? 1;
          const price = balance.lastRate / divisor;
          const currency = balance.currencyCode || 'ILS';
          priceMap.set(balance.equityNumber, { price, currency });
        }
      }
    } catch {
      this.store.clearSession();
      return tickers.map((ticker) => ({ ticker, status: 'error' as const, error: 'session_expired' }));
    }

    // Map requested tickers to prices
    return tickers.map((ticker): PriceResult => {
      const entry = priceMap.get(ticker);
      if (!entry) {
        return { ticker, status: 'error', error: 'not_found' };
      }
      return { ticker, status: 'success', price: entry.price, currency: entry.currency };
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
