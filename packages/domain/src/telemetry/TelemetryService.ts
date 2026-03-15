export interface TelemetryEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: string;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
}

export class ConsoleTelemetrySink implements TelemetrySink {
  emit(event: TelemetryEvent): void {
    console.log(`[TELEMETRY] ${event.name}`, event.properties ?? {});
  }
}

export class TelemetryService {
  constructor(private readonly sink: TelemetrySink) {}

  trackImportPreview(params: {
    providerId: string;
    validCount: number;
    invalidCount: number;
    duplicateCount: number;
  }): void {
    this.sink.emit({
      name: 'import.preview',
      properties: params,
      timestamp: new Date().toISOString(),
    });
  }

  trackImportCommit(params: {
    providerId: string;
    runId: string;
    importedCount: number;
    skippedCount: number;
    errorCount: number;
  }): void {
    this.sink.emit({
      name: 'import.commit',
      properties: params,
      timestamp: new Date().toISOString(),
    });
  }

  trackImportUndo(params: { runId: string }): void {
    this.sink.emit({
      name: 'import.undo',
      properties: params,
      timestamp: new Date().toISOString(),
    });
  }

  trackError(params: { operation: string; error: string }): void {
    this.sink.emit({
      name: 'import.error',
      properties: params,
      timestamp: new Date().toISOString(),
    });
  }
}
