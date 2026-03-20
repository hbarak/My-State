export interface UploadedCsvPayload {
  sourceName: string;
  csvText: string;
  headers: string[];
  rowCount: number;
  detectedEncoding: string;
}

export function parseCsvForHandoff(
  csvText: string,
  sourceName: string,
  detectedEncoding = 'text',
): UploadedCsvPayload {
  const normalized = normalizeCsvText(csvText);
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one data row.');
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim()).filter((header) => header.length > 0);
  if (headers.length === 0) {
    throw new Error('CSV header row is empty.');
  }

  return {
    sourceName,
    csvText: normalized,
    headers,
    rowCount: lines.length - 1,
    detectedEncoding,
  };
}

export async function parseCsvFileForHandoff(file: File): Promise<UploadedCsvPayload> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const utf8 = decodeBytes(bytes, 'utf-8');
  const win1255 = decodeBytes(bytes, 'windows-1255');

  const preferred = choosePreferredDecode(utf8, win1255);
  try {
    return parseCsvForHandoff(preferred.text, file.name, preferred.encoding);
  } catch {
    // If heuristic picked badly, fallback to the alternate decode path.
    const alternate = preferred.encoding === 'utf-8' ? win1255 : utf8;
    return parseCsvForHandoff(alternate.text, file.name, alternate.encoding);
  }
}

function normalizeCsvText(input: string): string {
  return input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
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
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function decodeBytes(bytes: Uint8Array, encoding: string): { encoding: string; text: string } {
  try {
    const decoder = new TextDecoder(encoding, { fatal: false });
    return { encoding, text: decoder.decode(bytes) };
  } catch {
    const fallback = new TextDecoder('utf-8', { fatal: false });
    return { encoding: 'utf-8', text: fallback.decode(bytes) };
  }
}

function choosePreferredDecode(
  utf8: { encoding: string; text: string },
  win1255: { encoding: string; text: string },
): { encoding: string; text: string } {
  const utf8Score = scoreDecodedText(utf8.text);
  const win1255Score = scoreDecodedText(win1255.text);
  return win1255Score > utf8Score ? win1255 : utf8;
}

function scoreDecodedText(text: string): number {
  const replacement = (text.match(/�/g) ?? []).length;
  const hebrew = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;
  return hebrew * 3 + commas - replacement * 6;
}
