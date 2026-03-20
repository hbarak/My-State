export type ResolutionAction = 'map_now' | 'skip_batch' | 'cancel_import';
export type ResolutionRowOutcome = 'skip' | 'map_pending' | 'cancel_pending';

export interface ResolutionRunDecision {
  action: ResolutionAction;
  note?: string;
  blockedRowCount: number;
}

export interface ResolutionRowTag {
  rowNumber: number;
  reasonCode: string;
  resolution: ResolutionRowOutcome;
  note?: string;
}

export interface ResolutionAuditRecord {
  id: string;
  clientRunId: string;
  providerId: string;
  providerIntegrationId: string;
  sourceName: string;
  csvHash: string;
  createdAt: string;
  runDecision: ResolutionRunDecision;
  rowTags: ResolutionRowTag[];
}

const KEY = 'my-stocks:web:resolution-audit.v1';

export function saveResolutionAuditRecord(input: {
  clientRunId: string;
  providerId: string;
  providerIntegrationId: string;
  sourceName: string;
  csvText: string;
  runDecision: ResolutionRunDecision;
  rowTags: ResolutionRowTag[];
}): ResolutionAuditRecord {
  const record: ResolutionAuditRecord = {
    id: makeId('res_audit'),
    clientRunId: input.clientRunId,
    providerId: input.providerId,
    providerIntegrationId: input.providerIntegrationId,
    sourceName: input.sourceName,
    csvHash: hashText(input.csvText),
    createdAt: new Date().toISOString(),
    runDecision: input.runDecision,
    rowTags: input.rowTags,
  };

  const current = readAuditRecords();
  writeAuditRecords([record, ...current]);
  return record;
}

export function listResolutionAuditRecords(): ResolutionAuditRecord[] {
  return readAuditRecords();
}

function readAuditRecords(): ResolutionAuditRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ResolutionAuditRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAuditRecords(records: ResolutionAuditRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(KEY, JSON.stringify(records));
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function hashText(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
