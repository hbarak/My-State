import type { ProviderMappingProfile } from '../types';

export type PatternFitDecision = 'pass' | 'warn' | 'fail';

export interface PatternFitResult {
  decision: PatternFitDecision;
  fitScore: number;
  reasons: string[];
}

export function runCsvPatternFitCheck(profile: ProviderMappingProfile, csvText: string): PatternFitResult {
  const encodingCheck = runEncodingCheck(profile, csvText);
  if (encodingCheck) {
    return encodingCheck;
  }

  const headers = extractCsvHeaders(csvText);

  const requiredHeaders = (profile.requiredCanonicalFields ?? [])
    .map((field) => profile.fieldMappings[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  const missingRequiredHeaders = requiredHeaders.filter((header) => !headers.has(header));
  if (missingRequiredHeaders.length > 0) {
    return {
      decision: 'fail',
      fitScore: 0,
      reasons: [`Missing required headers: ${missingRequiredHeaders.join(', ')}`],
    };
  }

  const mappedHeaders = Object.values(profile.fieldMappings)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const matchedMappedHeaders = mappedHeaders.filter((header) => headers.has(header)).length;
  const fitScore = mappedHeaders.length === 0
    ? 100
    : Math.round((matchedMappedHeaders / mappedHeaders.length) * 100);

  if (fitScore >= 90) {
    return {
      decision: 'pass',
      fitScore,
      reasons: ['Pattern fit passed'],
    };
  }

  return {
    decision: 'warn',
    fitScore,
    reasons: ['Pattern fit below high-confidence threshold'],
  };
}

function runEncodingCheck(profile: ProviderMappingProfile, csvText: string): PatternFitResult | null {
  const expectedEncoding = String(profile.parsingRules?.expectedEncoding ?? '').toLowerCase();
  if (!expectedEncoding) return null;

  const shouldCheckHebrewMojibake =
    expectedEncoding.includes('1255') ||
    expectedEncoding.includes('hebrew') ||
    expectedEncoding.includes('windows-1255');

  if (!shouldCheckHebrewMojibake) return null;

  if (looksLikeMojibake(csvText)) {
    return {
      decision: 'fail',
      fitScore: 0,
      reasons: ['Input appears mis-decoded (mojibake). Expected WINDOWS-1255/Hebrew decoding before import.'],
    };
  }

  return null;
}

function looksLikeMojibake(input: string): boolean {
  const replacementCharCount = (input.match(/�/g) ?? []).length;
  return replacementCharCount > 0;
}

function extractCsvHeaders(csvText: string): Set<string> {
  const firstLine = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return new Set<string>();

  return new Set(splitCsvLine(firstLine));
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"' && (inQuotes || current.length === 0)) {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
}
