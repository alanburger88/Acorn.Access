/**
 * RENDERING — PDF renderer via pdfkit. Pure function over the ComposedDocument
 * returning the finished PDF bytes.
 */
import PDFDocument from 'pdfkit';
import type { ComposedDocument, ComposedLine } from '../../kernel/contracts.js';

export const PDF_CONTENT_TYPE = 'application/pdf';

const MARGIN = 50;
const PAGE_BREAK_Y = 750;

type Pdf = InstanceType<typeof PDFDocument>;

function contentWidth(pdf: Pdf): number {
  return pdf.page.width - MARGIN * 2;
}

/** Add a page when the cursor is past the safe area. */
function ensureRoom(pdf: Pdf, needed = 0): void {
  if (pdf.y + needed > PAGE_BREAK_Y) {
    pdf.addPage();
    pdf.y = MARGIN;
  }
}

function sectionHeading(pdf: Pdf, title: string, color: string): void {
  ensureRoom(pdf, 40);
  pdf.moveDown(0.8);
  pdf.font('Helvetica-Bold').fontSize(13).fillColor(color).text(title, MARGIN, pdf.y, {
    width: contentWidth(pdf),
  });
  const y = pdf.y + 2;
  pdf.moveTo(MARGIN, y).lineTo(MARGIN + contentWidth(pdf), y).lineWidth(1).strokeColor(color).stroke();
  pdf.y = y + 8;
  pdf.fillColor('#222222');
}

function fieldRow(pdf: Pdf, label: string, value: string): void {
  ensureRoom(pdf, 18);
  const y = pdf.y;
  const half = contentWidth(pdf) / 2;
  pdf.font('Helvetica').fontSize(10).fillColor('#51637a').text(label, MARGIN, y, { width: half });
  const labelBottom = pdf.y;
  pdf.font('Helvetica-Bold').fontSize(10).fillColor('#222222').text(value, MARGIN + half, y, {
    width: half,
    align: 'right',
  });
  pdf.y = Math.max(labelBottom, pdf.y) + 3;
}

function table(pdf: Pdf, line: Extract<ComposedLine, { kind: 'table' }>): void {
  const width = contentWidth(pdf);
  const cols = Math.max(line.headers.length, 1);
  const colWidth = width / cols; // equal column widths across the content width
  const cellWidth = colWidth - 6;

  if (line.title) {
    ensureRoom(pdf, 20);
    pdf.font('Helvetica-Bold').fontSize(11).fillColor('#222222').text(line.title, MARGIN, pdf.y, { width });
    pdf.moveDown(0.3);
  }

  const drawRow = (cells: string[], bold: boolean): void => {
    const font = bold ? 'Helvetica-Bold' : 'Helvetica';
    pdf.font(font).fontSize(9);
    const height = Math.max(
      ...cells.map((cell) => pdf.heightOfString(cell, { width: cellWidth })),
      12,
    );
    ensureRoom(pdf, height + 6);
    const y = pdf.y;
    cells.forEach((cell, i) => {
      pdf.text(cell, MARGIN + i * colWidth, y, {
        width: cellWidth,
        align: line.aligns[i] === 'right' ? 'right' : 'left',
      });
    });
    pdf.y = y + height + 4;
  };

  pdf.fillColor('#222222');
  drawRow(line.headers, true);
  // underline the header row
  const underlineY = pdf.y - 2;
  pdf.moveTo(MARGIN, underlineY).lineTo(MARGIN + width, underlineY).lineWidth(0.8).strokeColor('#666666').stroke();
  pdf.y = underlineY + 4;
  for (const row of line.rows) drawRow(row, false);
  pdf.moveDown(0.4);
}

function renderLine(pdf: Pdf, line: ComposedLine, brandColor: string): void {
  const width = contentWidth(pdf);
  switch (line.kind) {
    case 'heading':
      ensureRoom(pdf, 24);
      pdf.moveDown(0.4);
      pdf.font('Helvetica-Bold').fontSize(11).fillColor('#222222').text(line.text, MARGIN, pdf.y, { width });
      pdf.moveDown(0.2);
      break;
    case 'text':
      ensureRoom(pdf, 24);
      pdf.font('Helvetica').fontSize(10).fillColor('#222222').text(line.text, MARGIN, pdf.y, { width });
      pdf.moveDown(0.4);
      break;
    case 'summary':
      ensureRoom(pdf, 36);
      pdf.font('Helvetica-Bold').fontSize(11).fillColor(brandColor).text(line.title, MARGIN, pdf.y, { width });
      pdf.font('Helvetica').fontSize(10).fillColor('#222222').text(line.text, MARGIN, pdf.y, { width });
      pdf.moveDown(0.4);
      break;
    case 'field-row':
      fieldRow(pdf, line.label, line.value);
      break;
    case 'table':
      table(pdf, line);
      break;
    case 'content':
      ensureRoom(pdf, 36);
      pdf.font('Helvetica-Bold').fontSize(10.5).fillColor('#222222').text(line.title, MARGIN, pdf.y, { width });
      pdf.moveDown(0.15);
      for (const paragraph of line.text.split(/\n{2,}/).filter((p) => p.trim().length > 0)) {
        ensureRoom(pdf, 24);
        // content blocks render as justified paragraphs
        pdf.font('Helvetica').fontSize(9.5).fillColor('#333333').text(paragraph.trim(), MARGIN, pdf.y, {
          width,
          align: 'justify',
        });
        pdf.moveDown(0.3);
      }
      break;
    case 'action':
      // Interactive actions have no PDF equivalent — note where to find them.
      ensureRoom(pdf, 18);
      pdf.font('Helvetica-Oblique').fontSize(9.5).fillColor('#51637a').text(
        `Available online: ${line.label}`,
        MARGIN,
        pdf.y,
        { width },
      );
      pdf.moveDown(0.3);
      break;
    case 'divider': {
      ensureRoom(pdf, 14);
      const y = pdf.y + 4;
      pdf.moveTo(MARGIN, y).lineTo(MARGIN + width, y).lineWidth(0.5).strokeColor('#cccccc').stroke();
      pdf.y = y + 8;
      break;
    }
    default:
      break;
  }
}

export function renderPdf(doc: ComposedDocument): Promise<{ buf: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', bufferPages: true, margin: MARGIN });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve({ buf: Buffer.concat(chunks), contentType: PDF_CONTENT_TYPE }));
    pdf.on('error', reject);

    try {
      // Brand header band with white logo text + title.
      pdf.rect(0, 0, pdf.page.width, 92).fill(doc.brand.primaryColor);
      pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(doc.brand.logoText.toUpperCase(), MARGIN, 24, {
        width: contentWidth(pdf),
      });
      pdf.font('Helvetica-Bold').fontSize(18).text(doc.title, MARGIN, 44, { width: contentWidth(pdf) });

      const date = new Intl.DateTimeFormat(doc.locale || 'en-US', { dateStyle: 'long' }).format(new Date());
      pdf.fillColor('#51637a').font('Helvetica').fontSize(10).text(
        `Prepared for ${doc.customerName} — ${date}`,
        MARGIN,
        108,
        { width: contentWidth(pdf) },
      );
      pdf.y = 130;

      for (const section of doc.sections) {
        sectionHeading(pdf, section.title, doc.brand.primaryColor);
        if (section.explanation) {
          pdf.font('Helvetica-Oblique').fontSize(9.5).fillColor('#51637a').text(section.explanation, MARGIN, pdf.y, {
            width: contentWidth(pdf),
          });
          pdf.moveDown(0.4);
        }
        for (const line of section.lines) renderLine(pdf, line, doc.brand.primaryColor);
      }

      // Footer: iterate buffered pages and stamp 'Page X of Y'.
      const range = pdf.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        pdf.switchToPage(i);
        // Drop the bottom margin so writing in the footer area never triggers
        // an automatic page break.
        pdf.page.margins.bottom = 0;
        pdf.font('Helvetica').fontSize(9).fillColor('#888888').text(
          `Page ${i - range.start + 1} of ${range.count}`,
          MARGIN,
          pdf.page.height - 30,
          { width: contentWidth(pdf), align: 'center', lineBreak: false },
        );
      }
      pdf.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
