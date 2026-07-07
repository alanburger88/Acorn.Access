/**
 * MIGRATION STUDIO — legacy document extraction (platform/09 §2-§3).
 *
 * Converts a legacy HTML or plain-text communication into template blocks
 * plus data-contract variable suggestions. This is the reference,
 * dependency-free stand-in for the production Extraction Engine: a pragmatic
 * regex/state pass rather than a DOM library — legacy statement markup is
 * shallow and regular enough that a "poor man's SAX" over the tags we care
 * about (h1-h3, table, p, li) visits them faithfully in document order.
 */
import type { TemplateBlock } from '../../kernel/contracts.js';

export interface ExtractedVariable {
  path: string;
  sample: string;
  kind: 'currency' | 'date' | 'number' | 'text';
}

export interface ExtractionResult {
  title: string;
  blocks: TemplateBlock[];
  variables: ExtractedVariable[];
}

type SectionBlock = Extract<TemplateBlock, { kind: 'section' }>;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Decode the basic HTML entities legacy exports actually use. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

/** Strip residual inner tags (<strong>, <span>...), decode entities, collapse whitespace. */
function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/** 'Balance Due:' → 'balanceDue' */
function camelCase(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

// ---------------------------------------------------------------------------
// Variable detection
// ---------------------------------------------------------------------------

/**
 * Detection patterns in priority order. Earlier kinds win: a currency amount
 * must not later be re-detected as a long number (once replaced, the
 * '{{path|kind}}' placeholder contains no digits, so later passes skip it).
 */
const VARIABLE_PATTERNS: { kind: ExtractedVariable['kind']; re: RegExp }[] = [
  { kind: 'currency', re: /\$[\d,]+\.\d{2}/g },
  {
    kind: 'date',
    re: /\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4}\b/g,
  },
  // account-like tokens keep their literal shape → kind 'text', no format suffix
  { kind: 'text', re: /\b\d{4}[- ]?\d{4,}\b|\bX{2,}\d{4}\b/g },
  { kind: 'number', re: /\b\d{5,}\b/g },
];

/** A label immediately preceding the match ('Balance Due: $1,234.56') names the variable. */
const PRECEDING_LABEL = /([A-Za-z][A-Za-z0-9 ]{0,40}?)\s*:\s*$/;

interface VariableDetector {
  /** Replace variable occurrences in `text` with '{{path|kind}}' placeholders. */
  detect(text: string, labelHint?: string): string;
  readonly variables: ExtractedVariable[];
}

function createVariableDetector(): VariableDetector {
  const bySample = new Map<string, ExtractedVariable>(); // dedupe identical samples → one path
  const usedPaths = new Set<string>();
  let fieldSeq = 0;
  const variables: ExtractedVariable[] = [];

  function pathFor(sample: string, kind: ExtractedVariable['kind'], label?: string): string {
    const existing = bySample.get(sample);
    if (existing) return existing.path;
    let candidate = label ? camelCase(label) : '';
    if (!candidate || usedPaths.has(candidate)) {
      // fall back to (or disambiguate with) a sequential field name
      do candidate = `field${++fieldSeq}`;
      while (usedPaths.has(candidate));
    }
    usedPaths.add(candidate);
    const variable: ExtractedVariable = { path: candidate, sample, kind };
    bySample.set(sample, variable);
    variables.push(variable);
    return candidate;
  }

  function detect(text: string, labelHint?: string): string {
    let out = text;
    for (const { kind, re } of VARIABLE_PATTERNS) {
      out = out.replace(re, (match: string, ...rest: unknown[]) => {
        // no capture groups in any pattern → args are (match, offset, string)
        const offset = rest[0] as number;
        const full = rest[1] as string;
        const label = PRECEDING_LABEL.exec(full.slice(0, offset))?.[1] ?? labelHint;
        const path = pathFor(match, kind, label);
        // currency/date/number carry a format suffix; plain text does not
        return kind === 'text' ? `{{${path}}}` : `{{${path}|${kind}}}`;
      });
    }
    return out;
  }

  return { detect, variables };
}

// ---------------------------------------------------------------------------
// HTML mode
// ---------------------------------------------------------------------------

function extractHtml(payload: string, detector: VariableDetector): { title: string; blocks: TemplateBlock[] } {
  // Remove non-content containers wholesale before scanning.
  const html = payload
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // One alternation regex visits the tags of interest in document order.
  // Groups: 1=heading level, 2=heading text, 3=table inner, 4=p|li tag, 5=p|li text.
  const token =
    /<h([123])[^>]*>([\s\S]*?)<\/h\1\s*>|<table[^>]*>([\s\S]*?)<\/table\s*>|<(p|li)[^>]*>([\s\S]*?)<\/\4\s*>/gi;

  let title = '';
  const blocks: TemplateBlock[] = [];
  let section: SectionBlock | undefined;
  let tableCount = 0;
  const target = (): TemplateBlock[] => (section ? section.blocks : blocks);

  let m: RegExpExecArray | null;
  while ((m = token.exec(html))) {
    if (m[1] !== undefined) {
      const text = cleanText(m[2] ?? '');
      if (!text) continue;
      if (m[1] === '1' && !title) {
        // first h1 names the template and stays a top-level document heading
        title = text;
        blocks.push({ kind: 'heading', level: 1, text });
      } else {
        // h2/h3 (and any further h1) start a new section, id slugified from the heading
        section = { kind: 'section', id: slugify(text), title: text, blocks: [] };
        blocks.push(section);
      }
    } else if (m[3] !== undefined) {
      // <table> → table block. Headers come from the first row's th/td cells;
      // data rows are variable data by definition, so the block binds to a
      // synthetic itemsPath ('table1'...) with columns 'col1'..'colN'.
      tableCount++;
      const firstRow = /<tr[\s\S]*?<\/tr\s*>/i.exec(m[3])?.[0] ?? '';
      const headers = [...firstRow.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)].map((c) =>
        cleanText(c[1] ?? ''),
      );
      target().push({
        kind: 'table',
        itemsPath: `table${tableCount}`,
        columns: headers.map((h, i) => ({ header: h || `Column ${i + 1}`, valuePath: `col${i + 1}` })),
      });
    } else if (m[5] !== undefined) {
      const text = cleanText(m[5]);
      if (text) target().push({ kind: 'text', text: detector.detect(text) });
    }
  }

  return { title, blocks };
}

// ---------------------------------------------------------------------------
// Text mode
// ---------------------------------------------------------------------------

const UNDERLINE = /^[-=]{3,}\s*$/;
/** ALL-CAPS line (with common punctuation) up to 60 chars, no colon → heading. */
const ALL_CAPS = /^[A-Z0-9][A-Z0-9 .,&'()/-]{0,59}$/;
const LABEL_VALUE = /^([A-Za-z][A-Za-z0-9 ]{0,40}):\s+(.+)$/;

function extractText(payload: string, detector: VariableDetector): { title: string; blocks: TemplateBlock[] } {
  const lines = payload.split(/\r?\n/).map((l) => l.trim());

  let title = '';
  const blocks: TemplateBlock[] = [];
  let section: SectionBlock | undefined;
  let paragraph: string[] = [];
  const target = (): TemplateBlock[] => (section ? section.blocks : blocks);

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    // NOTE (table heuristic, deliberately conservative): runs of 2+ spaces on
    // consecutive aligned lines would suggest a fixed-width text table, but
    // column inference from plain text is unreliable — such runs fall back to
    // plain text blocks here; the human reviewer promotes them in the designer.
    target().push({ kind: 'text', text: detector.detect(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line) {
      flushParagraph();
      continue;
    }
    const underlined = UNDERLINE.test(lines[i + 1] ?? '');
    const allCaps = ALL_CAPS.test(line) && /[A-Z]/.test(line) && !line.includes(':');
    if (underlined || allCaps) {
      flushParagraph();
      if (underlined) i++; // consume the ---/=== underline
      if (!title) {
        // first heading names the document and stays a top-level heading
        title = line;
        blocks.push({ kind: 'heading', level: 1, text: line });
      } else {
        section = { kind: 'section', id: slugify(line), title: line, blocks: [] };
        blocks.push(section);
      }
      continue;
    }
    const label = LABEL_VALUE.exec(line);
    if (label) {
      flushParagraph();
      target().push({
        kind: 'field-row',
        label: label[1] ?? '',
        value: detector.detect(label[2] ?? '', label[1]),
      });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  return { title, blocks };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function extractLegacy(payload: string, sourceFormat: 'html' | 'text'): ExtractionResult {
  const detector = createVariableDetector();
  const { title, blocks } =
    sourceFormat === 'html' ? extractHtml(payload, detector) : extractText(payload, detector);
  return { title, blocks, variables: detector.variables };
}
