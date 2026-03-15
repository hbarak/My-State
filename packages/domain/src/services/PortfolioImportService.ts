import type { PortfolioRepository } from '../repositories';
import type { TelemetryService } from '../telemetry';
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
  private readonly telemetry?: TelemetryService;

  constructor(repository: PortfolioRepository, telemetry?: TelemetryService) {
    this.orchestrator = new ImportOrchestrator(repository, [
      new TradesImportHandler(repository),
      new PsagotHoldingsImportHandler(repository),
    ]);
    this.telemetry = telemetry;
  }

  async previewImport(params: {
    providerId: string;
    providerIntegrationId: string;
    csvText: string;
  }): Promise<ImportPreviewResult> {
    try {
      const result = await this.orchestrator.previewImport(params);
      this.telemetry?.trackImportPreview({
        providerId: params.providerId,
        validCount: result.validRows.length,
        invalidCount: result.invalidRows.length,
        duplicateCount: result.duplicateRows.length,
      });
      return result;
    } catch (error) {
      this.telemetry?.trackError({
        operation: 'previewImport',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async commitImport(params: {
    providerId: string;
    providerIntegrationId: string;
    sourceName: string;
    csvText: string;
  }): Promise<ImportCommitResult> {
    try {
      const result = await this.orchestrator.commitImport(params);
      this.telemetry?.trackImportCommit({
        providerId: params.providerId,
        runId: result.importRun.id,
        importedCount: result.importedTrades,
        skippedCount: result.skippedRows,
        errorCount: result.errorRows,
      });
      return result;
    } catch (error) {
      this.telemetry?.trackError({
        operation: 'commitImport',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async undoLastImport(providerIntegrationId: string) {
    try {
      const result = await this.orchestrator.undoLastImport(providerIntegrationId);
      if (result) {
        this.telemetry?.trackImportUndo({ runId: result.id });
      }
      return result;
    } catch (error) {
      this.telemetry?.trackError({
        operation: 'undoLastImport',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
