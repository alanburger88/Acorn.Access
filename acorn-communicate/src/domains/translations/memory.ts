/**
 * TRANSLATIONS bounded context — sentence-level translation memory.
 *
 * Previously translated sentences are stored keyed by sha256(source + locale)
 * in the 'translationMemory' collection and reused verbatim on later
 * translations (consistency across communications + reuse metric). Segments
 * are sentences: the text is split on [.!?] runs keeping the delimiters, and
 * {{placeholders}} are masked before segmentation so a dot inside a
 * placeholder path never splits a sentence.
 */
import { createHash } from 'node:crypto';
import type { CollectionPort } from '../../kernel/storage.js';
import { newId } from '../../kernel/ids.js';
import { protectPlaceholders, translateText, type MachineLocale } from './dictionary.js';

export interface TranslationMemoryEntry {
  id: string; // tmx_
  tenantId: string;
  locale: string;
  /** sha256(sourceSegment + locale) — the lookup key */
  sourceHash: string;
  source: string;
  target: string;
  createdAt: string;
}

export const segmentHash = (source: string, locale: string): string =>
  createHash('sha256').update(source + locale).digest('hex');

export function lookup(
  memory: CollectionPort<TranslationMemoryEntry>,
  tenantId: string,
  locale: string,
  source: string,
): TranslationMemoryEntry | undefined {
  const hash = segmentHash(source, locale);
  return memory.list(tenantId, (e) => e.locale === locale && e.sourceHash === hash).at(0);
}

export function store(
  memory: CollectionPort<TranslationMemoryEntry>,
  tenantId: string,
  locale: string,
  source: string,
  target: string,
): TranslationMemoryEntry {
  const entry: TranslationMemoryEntry = {
    id: newId('tmx'),
    tenantId,
    locale,
    sourceHash: segmentHash(source, locale),
    source,
    target,
    createdAt: new Date().toISOString(),
  };
  memory.put(entry);
  return entry;
}

/**
 * Translate a text sentence-by-sentence: memory first (counting hits), the
 * deterministic dictionary for misses, storing every newly translated pair.
 * Memory keys are the original sentences (placeholders restored) so the same
 * sentence reuses its translation regardless of where placeholders sit in
 * the surrounding document.
 */
export function translateWithMemory(
  memory: CollectionPort<TranslationMemoryEntry>,
  tenantId: string,
  text: string,
  locale: MachineLocale,
): { text: string; memoryHits: number } {
  const { masked, restore } = protectPlaceholders(text);
  const parts = masked.split(/([.!?]+)/);
  let memoryHits = 0;
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part; // delimiter run — pass through
    const lead = /^\s*/.exec(part)?.[0] ?? '';
    const trail = /\s*$/.exec(part.slice(lead.length))?.[0] ?? '';
    const core = part.trim();
    if (!core) return part;
    const source = restore(core); // original sentence, placeholders intact
    const hit = lookup(memory, tenantId, locale, source);
    let target: string;
    if (hit) {
      memoryHits += 1;
      target = hit.target;
    } else {
      target = translateText(source, locale);
      store(memory, tenantId, locale, source, target);
    }
    return lead + target + trail;
  });
  return { text: out.join(''), memoryHits };
}
