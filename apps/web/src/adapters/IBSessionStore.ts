/**
 * In-memory store for IB Client Portal Gateway session state.
 *
 * The gateway manages the actual session (browser-based login, cookies).
 * We only track:
 *   - Whether the gateway is currently authenticated
 *   - The conid→ticker mapping built during the last sync
 *   - The last tickle timestamp (for monitoring session health)
 */
export class IBSessionStore {
  private authenticated = false;
  private lastTickleAt: Date | null = null;
  /** Maps conid (as string) → ticker symbol (e.g. "265598" → "AAPL") */
  private conidToTicker: Map<string, string> = new Map();
  /** Maps conid (as string) → contract description (e.g. "265598" → "AAPL (NASDAQ)") */
  private conidToDesc: Map<string, string> = new Map();

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  setAuthenticated(value: boolean): void {
    this.authenticated = value;
  }

  recordTickle(): void {
    this.lastTickleAt = new Date();
  }

  getLastTickleAt(): Date | null {
    return this.lastTickleAt;
  }

  /**
   * Update the conid→ticker and conid→desc maps from sync results.
   * Called after a successful IB positions sync.
   */
  setConidMaps(
    conidToTicker: ReadonlyMap<string, string>,
    conidToDesc: ReadonlyMap<string, string>,
  ): void {
    this.conidToTicker = new Map(conidToTicker);
    this.conidToDesc = new Map(conidToDesc);
  }

  getTickerForConid(conid: string): string | undefined {
    return this.conidToTicker.get(conid);
  }

  getDescForConid(conid: string): string | undefined {
    return this.conidToDesc.get(conid);
  }

  getKnownConids(): ReadonlySet<string> {
    return new Set(this.conidToTicker.keys());
  }

  clearSession(): void {
    this.authenticated = false;
    this.lastTickleAt = null;
  }
}
