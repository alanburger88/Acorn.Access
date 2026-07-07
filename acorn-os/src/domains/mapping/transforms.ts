/**
 * Mapping transforms — pure functions turning a messy source record's values
 * into contract-shaped values (see MappingTransform in kernel/contracts.ts).
 */
import type { MappingTransform } from '../../kernel/contracts.js';
import { getPath } from '../../kernel/values.js';

/** Parse common date shapes to 'YYYY-MM-DD'; undefined when unparseable. */
function toIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  // ISO passthrough: YYYY-MM-DD, optionally with a time part.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // US-style MM/DD/YYYY (also M/D/YYYY).
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
    return `${mdy[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  // 'Month D, YYYY' and friends via Date parsing (local components — no TZ shift).
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${mm}-${dd}`;
}

/**
 * Apply one transform to a source record. `undefined` means "no value" — the
 * caller skips the target path entirely rather than writing undefined.
 */
export function applyTransform(t: MappingTransform, record: Record<string, unknown>): unknown {
  switch (t.kind) {
    case 'copy':
      return getPath(record, t.source);
    case 'number': {
      const value = getPath(record, t.source);
      if (value === undefined || value === null) return undefined;
      const n = Number(String(value).replace(/[$,\s]/g, ''));
      return Number.isNaN(n) ? undefined : n;
    }
    case 'trim': {
      const value = getPath(record, t.source);
      if (value === undefined || value === null) return undefined;
      return String(value).trim();
    }
    case 'date-iso':
      return toIsoDate(getPath(record, t.source));
    case 'concat': {
      const parts = t.sources
        .map((source) => getPath(record, source))
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v));
      if (parts.length === 0) return undefined; // skip missing
      return parts.join(t.separator ?? ' ');
    }
    case 'constant':
      return t.value;
    default:
      return undefined;
  }
}

/** Set a dot-path value, building nested objects along the way. */
/** Segments that would let a crafted path reach the prototype chain. */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function setPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  // Prototype-pollution guard: rule targets are validated against the data
  // contract, but defense-in-depth costs one check.
  if (parts.some((p) => FORBIDDEN_SEGMENTS.has(p))) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
