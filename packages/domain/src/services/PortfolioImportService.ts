import type { PortfolioRepository } from '../repositories';
import {
  ImportOrchestrator,
  PsagotHoldingsImportHandler,
  TradesImportHandler,
  type ImportCommitResult,
  type ImportPreviewResult,
  type ImportPreviewRow,
} from './ImportOrchestrator';

export type { ImportCommitResult, ImportPreviewResult, ImportPreviewRow };

export class PortfolioImportService {
  private readonly orchestrator: ImportOrchestrator;

  constructor(repository: PortfolioRepository) {
    this.orchestrator = new ImportOrchestrator(repository, [
      new TradesImportHandler(repository),
      new PsagotHoldingsImportHandler(repository),
    ]);
  }

  previewImport(params: {
    providerId: string;
    providerIntegrationId: string;
    csvText: string;
  }): Promise<ImportPreviewResult> {
    return this.orchestrator.previewImport(params);
  }

  commitImport(params: {
    providerId: string;
    providerIntegrationId: string;
    sourceName: string;
    csvText: string;
  }): Promise<ImportCommitResult> {
    return this.orchestrator.commitImport(params);
  }

  undoLastImport(providerIntegrationId: string) {
    return this.orchestrator.undoLastImport(providerIntegrationId);
  }
}
