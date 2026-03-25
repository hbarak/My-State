import type { PortfolioRepository } from '../repositories/portfolioRepository';
import type { TickerSearcher } from '../ports/TickerSearcher';
import type { TickerMapping, TickerMappingStatus } from '../types/marketPrice';

export interface SecurityInput {
  readonly securityId: string;
  readonly securityName: string;
}

export class TickerResolverService {
  constructor(
    private readonly repository: PortfolioRepository,
    private readonly searcher: TickerSearcher,
  ) {}

  async resolveAll(
    securities: readonly SecurityInput[],
  ): Promise<ReadonlyMap<string, TickerMapping | null>> {
    const result = new Map<string, TickerMapping | null>();

    for (const sec of securities) {
      const mapping = await this.resolveSingle(sec);
      result.set(sec.securityId, mapping);
    }

    return result;
  }

  async resetMapping(securityId: string): Promise<void> {
    await this.repository.deleteTickerMapping(securityId);
  }

  async listMappingsWithStatus(): Promise<readonly TickerMappingStatus[]> {
    const mappings = await this.repository.listTickerMappings();
    return mappings.map((m): TickerMappingStatus => {
      let status: 'resolved' | 'failed' | 'manual';
      if (m.resolvedBy === 'manual') {
        status = 'manual';
      } else if (m.ticker !== null) {
        status = 'resolved';
      } else {
        status = 'failed';
      }
      return {
        securityId: m.securityId,
        securityName: m.securityName,
        ticker: m.ticker,
        resolvedBy: m.resolvedBy,
        resolvedAt: m.resolvedAt,
        status,
      };
    });
  }

  async setManualMapping(
    securityId: string,
    securityName: string,
    ticker: string,
  ): Promise<TickerMapping> {
    const mapping: TickerMapping = {
      securityId,
      securityName,
      ticker,
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'manual',
    };
    await this.repository.upsertTickerMapping(mapping);
    return mapping;
  }

  private async resolveSingle(sec: SecurityInput): Promise<TickerMapping | null> {
    // Check persistent cache first
    const cached = await this.repository.getTickerMapping(sec.securityId);
    if (cached) {
      return cached;
    }

    // Skip auto-resolve for empty/garbage names
    if (!sec.securityName?.trim()) {
      return null;
    }

    // Auto-resolve via searcher
    let ticker: string | null;
    try {
      ticker = await this.searcher.searchTicker(sec.securityName);
    } catch {
      // Search failure — return null but do NOT cache
      return null;
    }

    // Cache the result (including null for no-match)
    const mapping: TickerMapping = {
      securityId: sec.securityId,
      securityName: sec.securityName,
      ticker,
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'auto',
    };
    await this.repository.upsertTickerMapping(mapping);
    return mapping;
  }
}
