/**
 * Canonical JSON serialization following RFC 8785 (JCS).
 *
 * Determinism is load-bearing here: hashes and signatures are computed over
 * this serialization, so two independent implementations must produce
 * byte-identical output for the same logical value. ECMAScript's
 * `JSON.stringify` number and string formatting already matches RFC 8785,
 * so this implementation only adds key sorting and strictness.
 */

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new TypeError('Cannot canonicalize non-finite number');
    }
    return JSON.stringify(n);
  }
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalize(normalizeMember(item))).join(',') + ']';
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const members = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]));
    return '{' + members.join(',') + '}';
  }
  throw new TypeError(`Cannot canonicalize value of type ${t}`);
}

function normalizeMember(item: unknown): unknown {
  // JSON.stringify serializes undefined array members as null; match that.
  return item === undefined ? null : item;
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), 'utf8');
}
