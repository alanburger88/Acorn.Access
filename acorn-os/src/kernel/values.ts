import type { Rule, ValueFormat } from './contracts.js';

/** Resolve a dot path ("account.balanceDue") against a data record. */
export function getPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function formatValue(value: unknown, format: ValueFormat = 'text', locale = 'en-US'): string {
  if (value === undefined || value === null) return '';
  switch (format) {
    case 'currency': {
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(n)) return String(value);
      return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(n);
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(n)) return String(value);
      return new Intl.NumberFormat(locale).format(n);
    }
    case 'date': {
      const d = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
    }
    default:
      return String(value);
  }
}

/**
 * Interpolate `{{path}}` and `{{path|currency}}` placeholders. Unknown paths
 * resolve to '' (the data-contract validator reports missing required fields
 * before composition, so this is never a silent data loss path).
 */
export function interpolate(text: string, data: Record<string, unknown>, locale = 'en-US'): string {
  return text.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_m, path: string, fmt?: string) =>
    formatValue(getPath(data, path), (fmt as ValueFormat) ?? 'text', locale),
  );
}

export function evaluateRule(rule: Rule | undefined, data: Record<string, unknown>): boolean {
  if (!rule) return true;
  const actual = getPath(data, rule.path);
  switch (rule.op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return actual === rule.value;
    case 'ne':
      return actual !== rule.value;
    case 'gt':
      return typeof actual === 'number' && actual > Number(rule.value);
    case 'gte':
      return typeof actual === 'number' && actual >= Number(rule.value);
    case 'lt':
      return typeof actual === 'number' && actual < Number(rule.value);
    case 'lte':
      return typeof actual === 'number' && actual <= Number(rule.value);
    case 'contains':
      return typeof actual === 'string' && actual.includes(String(rule.value));
    default:
      return false;
  }
}

/** Escape text for safe HTML embedding (viewer and email renderers). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
