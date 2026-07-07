/**
 * RENDERING — interactive HTML document artifact.
 *
 * STRUCTURE IS A CONTRACT: the secure viewer shell injects this artifact and
 * instruments it (section tracking hooks onto `.doc-section[data-section-id]`,
 * expand tracking onto <details>, action wiring onto `.doc-action[data-action]`,
 * content pinning onto `[data-content-version]`). Renaming classes, data
 * attributes, or the element shapes below breaks the viewer. The artifact is a
 * semantic standalone page with NO <script> — all behavior is injected.
 */
import type { ComposedDocument, ComposedLine, ComposedSection } from '../../kernel/contracts.js';
import { escapeHtml } from '../../kernel/values.js';

const esc = escapeHtml;

function styles(doc: ComposedDocument): string {
  const { primaryColor, accentColor } = doc.brand;
  return `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1c2733;
    background: #f5f6f8;
    line-height: 1.5;
  }
  article.acorn-doc { max-width: 720px; margin: 0 auto; background: #fff; padding: 0 0 2rem; }
  .doc-header { background: ${esc(primaryColor)}; color: #fff; padding: 1.5rem 2rem; }
  .doc-header .doc-logo { display: block; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.9; }
  .doc-header h1 { margin: 0.35rem 0 0.25rem; font-size: 1.5rem; }
  .doc-header p { margin: 0; opacity: 0.9; }
  .doc-section { padding: 0.5rem 2rem; }
  .doc-section h2, .doc-section summary { color: ${esc(primaryColor)}; font-size: 1.15rem; font-weight: 700; border-bottom: 2px solid ${esc(accentColor)}; padding: 0.5rem 0 0.35rem; margin: 0.5rem 0; }
  details.doc-section summary { cursor: pointer; list-style-position: outside; }
  .doc-explain { background: #f0f4f8; border-left: 4px solid ${esc(accentColor)}; padding: 0.6rem 0.9rem; margin: 0.6rem 0; font-size: 0.92rem; color: #35455a; }
  .doc-summary { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem 1rem; margin: 0.75rem 0; }
  .doc-summary h3 { margin: 0 0 0.3rem; font-size: 1rem; }
  .doc-summary p { margin: 0; }
  .doc-field { display: flex; justify-content: space-between; gap: 1rem; padding: 0.4rem 0; border-bottom: 1px solid #edf1f5; }
  .doc-field-label { color: #51637a; }
  .doc-field-value { font-weight: 600; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
  caption { text-align: left; font-weight: 700; padding-bottom: 0.4rem; }
  th, td { padding: 0.45rem 0.6rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
  th { background: ${esc(primaryColor)}; color: #fff; }
  tbody tr:nth-child(even) { background: #f5f8fb; }
  th.right, td.right { text-align: right; }
  .doc-content { margin: 0.75rem 0; }
  .doc-content h3 { margin: 0 0 0.3rem; font-size: 1rem; }
  .doc-action {
    display: inline-block; margin: 0.75rem 0.5rem 0.25rem 0; padding: 0.6rem 1.4rem;
    background: ${esc(accentColor)}; color: #fff; border: 0; border-radius: 6px;
    font-size: 1rem; font-weight: 600; cursor: pointer;
  }
  .doc-action:focus-visible { outline: 3px solid ${esc(primaryColor)}; outline-offset: 2px; }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 1rem 0; }
  @media print { .doc-action { display: none; } }
  `;
}

function renderLine(line: ComposedLine): string {
  switch (line.kind) {
    case 'heading': {
      const tag = line.level <= 2 ? 'h3' : 'h4';
      return `<${tag}>${esc(line.text)}</${tag}>`;
    }
    case 'text':
      return `<p>${esc(line.text)}</p>`;
    case 'summary':
      return `<div class="doc-summary"><h3>${esc(line.title)}</h3><p>${esc(line.text)}</p></div>`;
    case 'field-row':
      return `<div class="doc-field"><span class="doc-field-label">${esc(line.label)}</span><span class="doc-field-value">${esc(line.value)}</span></div>`;
    case 'table': {
      const caption = line.title ? `<caption>${esc(line.title)}</caption>` : '';
      const head = line.headers
        .map((h, i) => `<th scope="col"${line.aligns[i] === 'right' ? ' class="right"' : ''}>${esc(h)}</th>`)
        .join('');
      const body = line.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell, i) => `<td${line.aligns[i] === 'right' ? ' class="right"' : ''}>${esc(cell)}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      return `<table>${caption}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case 'content': {
      const paragraphs = line.text
        .split(/\n{2,}/)
        .filter((p) => p.trim().length > 0)
        .map((p) => `<p>${esc(p.trim())}</p>`)
        .join('');
      return `<div class="doc-content" data-content-version="${esc(line.contentVersionId)}"><h3>${esc(line.title)}</h3>${paragraphs}</div>`;
    }
    case 'action':
      return `<button class="doc-action" type="button" data-action="${esc(line.action)}">${esc(line.label)}</button>`;
    case 'divider':
      return '<hr>';
    default:
      return '';
  }
}

function renderSection(section: ComposedSection): string {
  const explanation = section.explanation
    ? `<aside class="doc-explain">${esc(section.explanation)}</aside>`
    : '';
  const lines = section.lines.map(renderLine).join('\n');
  if (section.collapsible) {
    // <summary> is styled as a heading; native disclosure semantics make an
    // explicit aria-level unnecessary.
    return `<details class="doc-section" data-section-id="${esc(section.id)}" open><summary>${esc(section.title)}</summary>\n${explanation}${lines}</details>`;
  }
  return `<section class="doc-section" data-section-id="${esc(section.id)}"><h2>${esc(section.title)}</h2>\n${explanation}${lines}</section>`;
}

export const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

export function renderHtml(doc: ComposedDocument): { buf: Buffer; contentType: string } {
  const date = new Intl.DateTimeFormat(doc.locale || 'en-US', { dateStyle: 'long' }).format(new Date());
  const html = `<!doctype html>
<html lang="${esc(doc.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>${styles(doc)}</style>
</head>
<body>
<article class="acorn-doc">
<div class="doc-header">
<span class="doc-logo">${esc(doc.brand.logoText)}</span>
<h1>${esc(doc.title)}</h1>
<p>${esc(doc.customerName)} &middot; ${esc(date)}</p>
</div>
${doc.sections.map(renderSection).join('\n')}
</article>
</body>
</html>
`;
  return { buf: Buffer.from(html, 'utf8'), contentType: HTML_CONTENT_TYPE };
}
