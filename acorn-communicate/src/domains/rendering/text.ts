/**
 * RENDERING — plain-text renderer (accessibility/fallback format) and the SMS
 * channel text. Pure functions over the ComposedDocument.
 */
import type { ComposedDocument, ComposedLine } from '../../kernel/contracts.js';
import { interpolate } from '../../kernel/values.js';

export const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

const WRAP = 78;

/**
 * Interpolate {{path}} placeholders while PRESERVING the literal '{{link}}'
 * placeholder. interpolate() would resolve {{link}} against the data record
 * and wipe it to '' — so we swap it for a sentinel token first, interpolate,
 * then restore. The delivery domain substitutes the secure link at send time.
 */
export function interpolateKeepingLink(
  text: string,
  data: Record<string, unknown>,
  locale = 'en-US',
): string {
  const SENTINEL = '§LINK§'; // §LINK§ — never produced by interpolation
  return interpolate(text.replaceAll('{{link}}', SENTINEL), data, locale).replaceAll(
    SENTINEL,
    '{{link}}',
  );
}

/** Wrap a paragraph at `width` columns, preserving words. */
function wrap(text: string, width = WRAP): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function renderTable(line: Extract<ComposedLine, { kind: 'table' }>): string {
  // Compute per-column widths across header + all rows, then pad.
  const widths = line.headers.map((h, i) =>
    Math.max(h.length, ...line.rows.map((row) => (row[i] ?? '').length)),
  );
  const pad = (cell: string, i: number): string =>
    line.aligns[i] === 'right' ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0);
  const out: string[] = [];
  if (line.title) out.push(line.title);
  out.push(line.headers.map((h, i) => pad(h, i)).join('  '));
  out.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of line.rows) out.push(row.map((cell, i) => pad(cell, i)).join('  ').trimEnd());
  return out.join('\n');
}

function renderLine(line: ComposedLine): string {
  switch (line.kind) {
    case 'heading':
      return `${line.text}\n${'-'.repeat(Math.min(line.text.length, WRAP))}`;
    case 'text':
      return wrap(line.text);
    case 'summary':
      return `${line.title}\n${wrap(line.text)}`;
    case 'field-row':
      return `${line.label}: ${line.value}`;
    case 'table':
      return renderTable(line);
    case 'content':
      return `${line.title}\n${line.text
        .split(/\n{2,}/)
        .filter((p) => p.trim().length > 0)
        .map((p) => wrap(p.trim()))
        .join('\n\n')}`;
    case 'action':
      return `[Available online: ${line.label}]`;
    case 'divider':
      return '-'.repeat(WRAP);
    default:
      return '';
  }
}

export function renderText(doc: ComposedDocument): { buf: Buffer; contentType: string } {
  const parts: string[] = [];
  parts.push(doc.title);
  parts.push('='.repeat(Math.min(doc.title.length, WRAP)));
  parts.push(`Prepared for ${doc.customerName}`);
  for (const section of doc.sections) {
    parts.push('');
    parts.push(section.title.toUpperCase());
    parts.push('='.repeat(Math.min(Math.max(section.title.length, 4), WRAP)));
    if (section.explanation) parts.push(wrap(section.explanation));
    for (const line of section.lines) parts.push(renderLine(line));
  }
  parts.push('');
  return { buf: Buffer.from(parts.join('\n'), 'utf8'), contentType: TEXT_CONTENT_TYPE };
}

/**
 * SMS channel text: the template's channels.sms.text interpolated with the raw
 * data record, keeping '{{link}}' literal for the delivery domain.
 */
export function renderSms(
  template: string,
  rawData: Record<string, unknown>,
  locale = 'en-US',
): { buf: Buffer; contentType: string } {
  return {
    buf: Buffer.from(interpolateKeepingLink(template, rawData, locale), 'utf8'),
    contentType: TEXT_CONTENT_TYPE,
  };
}
