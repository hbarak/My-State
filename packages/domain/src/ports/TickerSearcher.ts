export interface TickerSearcher {
  searchTicker(securityName: string): Promise<string | null>;
}
