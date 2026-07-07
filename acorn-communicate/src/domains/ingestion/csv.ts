/**
 * INGESTION — minimal RFC-4180-style CSV parser.
 *
 * - First row is the header row.
 * - Fields may be quoted; `""` escapes a quote, and commas/newlines are
 *   allowed inside quotes.
 * - Scalar values are coerced: integers/decimals to number, true/false to
 *   boolean, everything else stays a string.
 * - Dot-path headers (e.g. `account.balanceDue`) expand into nested objects.
 */

/** Split raw CSV text into rows of string fields (quote-aware). */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop blank lines
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function coerce(raw: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

/** Set a dot-path key, creating intermediate objects as needed. */
function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = cur[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** Parse CSV text (header row + data rows) into coerced, nested records. */
export function parseCsv(payload: string): Record<string, unknown>[] {
  const rows = parseRows(payload);
  const headers = rows.at(0);
  if (!headers) return [];
  return rows.slice(1).map((cells) => {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]!.trim();
      if (!header) continue;
      setPath(record, header, coerce(cells[i] ?? ''));
    }
    return record;
  });
}
