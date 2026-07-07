/**
 * MIGRATION STUDIO — text similarity primitives (platform/09 §3 stage 4).
 *
 * The reference implementation uses word shingles + Jaccard instead of the
 * production embedding/ANN pipeline: it is deterministic, dependency-free,
 * and good enough to surface exact and near duplicates in the content
 * library and in extracted legacy paragraphs.
 */

/**
 * Word n-grams ("shingles") of a text: lowercased, punctuation-stripped,
 * whitespace-normalized. Texts shorter than `n` words yield a single shingle
 * of all their words so tiny texts still compare non-trivially.
 */
export function shingles(text: string, n = 3): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  if (words.length === 0) return out;
  if (words.length < n) {
    out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i <= words.length - n; i++) {
    out.add(words.slice(i, i + n).join(' '));
  }
  return out;
}

/** Jaccard index |A∩B| / |A∪B| over shingle sets. Empty-vs-anything is 0. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) if (b.has(s)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
