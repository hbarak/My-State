import type { PsagotAuthorizedSession, PsagotSecurityInfo } from '../../../../packages/domain/src/types/psagotApi';

/**
 * In-memory holder for a Psagot session and associated metadata.
 * Used by PsagotPriceFetcher to reuse an active session for price-only fetches
 * without going through the full import/sync flow.
 */
export class PsagotSessionStore {
  private session: PsagotAuthorizedSession | null = null;
  private accountKeys: readonly string[] = [];
  private securityInfoMap: ReadonlyMap<string, PsagotSecurityInfo> = new Map();
  /** Cache of symbol (upper-case) → Psagot equity number, built lazily during price fetches. */
  private tickerEquityCache: Map<string, string> = new Map();

  getSession(): PsagotAuthorizedSession | null {
    return this.session;
  }

  getAccountKeys(): readonly string[] {
    return this.accountKeys;
  }

  getSecurityInfoMap(): ReadonlyMap<string, PsagotSecurityInfo> {
    return this.securityInfoMap;
  }

  setSession(session: PsagotAuthorizedSession): void {
    this.session = session;
  }

  setAccountKeys(keys: readonly string[]): void {
    this.accountKeys = keys;
  }

  setSecurityInfoMap(map: ReadonlyMap<string, PsagotSecurityInfo>): void {
    this.securityInfoMap = map;
  }

  getCachedEquityNumber(symbol: string): string | undefined {
    return this.tickerEquityCache.get(symbol.toUpperCase());
  }

  setCachedEquityNumber(symbol: string, equityNumber: string): void {
    this.tickerEquityCache.set(symbol.toUpperCase(), equityNumber);
  }

  clearSession(): void {
    this.session = null;
  }

  hasActiveSession(): boolean {
    return this.session !== null;
  }
}
