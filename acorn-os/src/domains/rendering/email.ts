/**
 * RENDERING — email HTML renderer. Table-based, inline-styled markup for
 * broad email-client compatibility.
 *
 * Contract with the delivery domain:
 * - The FIRST LINE of the artifact is literally `<!--subject:...-->` — delivery
 *   extracts the final subject from it at send time.
 * - The CTA href keeps the LITERAL '{{link}}' placeholder; delivery substitutes
 *   the per-recipient secure link when it sends.
 */
import type { ComposedDocument, TemplateVersion } from '../../kernel/contracts.js';
import { escapeHtml } from '../../kernel/values.js';
import { interpolateKeepingLink } from './text.js';

export const EMAIL_CONTENT_TYPE = 'text/html; charset=utf-8';

const esc = escapeHtml;

export function renderEmail(
  doc: ComposedDocument,
  channel: NonNullable<TemplateVersion['channels']['email']>,
  rawData: Record<string, unknown>,
): { buf: Buffer; contentType: string } {
  // Subject interpolates against the RAW data record (not the composed doc),
  // preserving any literal {{link}} placeholder.
  const finalSubject = interpolateKeepingLink(channel.subject, rawData, doc.locale);
  const { primaryColor, accentColor, logoText } = doc.brand;

  // Summary card: the first section's field rows.
  const firstSection = doc.sections[0];
  const fieldRows = (firstSection?.lines ?? [])
    .filter((line): line is Extract<typeof line, { kind: 'field-row' }> => line.kind === 'field-row')
    .map(
      (line) => `<tr>
<td style="padding:6px 12px;color:#51637a;font-size:14px;">${esc(line.label)}</td>
<td style="padding:6px 12px;color:#1c2733;font-size:14px;font-weight:bold;text-align:right;">${esc(line.value)}</td>
</tr>`,
    )
    .join('\n');

  const preheader = channel.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;">${esc(
        interpolateKeepingLink(channel.preheader, rawData, doc.locale),
      )}</div>`
    : '';

  const html = `<!--subject:${finalSubject.replace(/-->/g, '')}-->
<!doctype html>
<html lang="${esc(doc.locale)}">
<head><meta charset="utf-8"><title>${esc(finalSubject)}</title></head>
<body style="margin:0;padding:0;background-color:#f5f6f8;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f6f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr>
<td style="background-color:${esc(primaryColor)};padding:20px 28px;">
<span style="color:#ffffff;font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${esc(logoText)}</span>
</td>
</tr>
<tr>
<td style="padding:28px 28px 8px;">
<h1 style="margin:0 0 8px;color:#1c2733;font-size:22px;">${esc(doc.title)}</h1>
<p style="margin:0;color:#51637a;font-size:14px;">Hello ${esc(doc.customerName)},</p>
</td>
</tr>
<tr>
<td style="padding:16px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
${fieldRows}
</table>
</td>
</tr>
<tr>
<td align="center" style="padding:8px 28px 24px;">
<!-- Bulletproof CTA button. href keeps the literal {{link}} placeholder; the delivery domain substitutes the secure link at send time. -->
<a href="{{link}}" style="display:inline-block;background-color:${esc(accentColor)};color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:6px;">View your secure document</a>
</td>
</tr>
<tr>
<td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;">
<p style="margin:0;color:#8494a8;font-size:12px;">This is a service communication regarding your account.</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
  return { buf: Buffer.from(html, 'utf8'), contentType: EMAIL_CONTENT_TYPE };
}
