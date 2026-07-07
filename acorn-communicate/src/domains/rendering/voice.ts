/**
 * Voice-script renderer — produces an SSML document for IVR / AI-voice-agent
 * playback (an accessibility + omnichannel output per platform/08). The script
 * reads the personalized summary and each section's plain-language explanation
 * (falling back to key field rows), which is exactly the material written for
 * human comprehension, then closes with the available actions spoken as
 * options. Output is valid SSML 1.0 wrapped in <speak>.
 */
import type { ComposedDocument, ComposedLine } from '../../kernel/contracts.js';

/** Escape text for SSML/XML content. */
function ssmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Speak a single composed line, or '' when it carries no useful audio. */
function speakLine(line: ComposedLine): string {
  switch (line.kind) {
    case 'heading':
      return `<emphasis level="moderate">${ssmlEscape(line.text)}</emphasis><break time="400ms"/>`;
    case 'summary':
      return `${ssmlEscape(line.title)}. <break time="300ms"/> ${ssmlEscape(line.text)}<break time="500ms"/>`;
    case 'text':
      return `${ssmlEscape(line.text)}<break time="300ms"/>`;
    case 'field-row':
      return `${ssmlEscape(line.label)}: ${ssmlEscape(line.value)}.<break time="250ms"/>`;
    case 'content':
      return `${ssmlEscape(line.text)}<break time="400ms"/>`;
    case 'action':
      return ''; // actions are collected and spoken together at the end
    case 'table':
    case 'divider':
      return ''; // tables don't read well aloud; skipped by design
    default:
      return '';
  }
}

const ACTION_PHRASES: Record<string, string> = {
  pay: 'to make a payment',
  dispute: 'to dispute a charge',
  'update-details': 'to update your contact details',
  contact: 'to speak with a representative',
  download: 'to receive a copy',
};

export function renderVoiceScript(doc: ComposedDocument): { buf: Buffer; contentType: string } {
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<speak xml:lang="${ssmlEscape(doc.locale)}">`);
  parts.push(
    `<p>Hello ${ssmlEscape(doc.customerName)}. This is a message from ${ssmlEscape(doc.brand.name)}.<break time="500ms"/></p>`,
  );

  const actions = new Set<string>();
  for (const section of doc.sections) {
    parts.push(`<p><emphasis level="strong">${ssmlEscape(section.title)}</emphasis><break time="400ms"/>`);
    if (section.explanation) parts.push(`${ssmlEscape(section.explanation)}<break time="400ms"/>`);
    for (const line of section.lines) {
      if (line.kind === 'action') actions.add(line.action);
      const spoken = speakLine(line);
      if (spoken) parts.push(spoken);
    }
    parts.push(`</p>`);
  }

  if (actions.size > 0) {
    const options = [...actions]
      .map((a) => ACTION_PHRASES[a] ?? `for ${ssmlEscape(a)}`)
      .join(', ');
    parts.push(
      `<p>You can act on this message online. Options include ${options}. ` +
        `Please use the secure link we sent you, or stay on the line to speak with someone.</p>`,
    );
  }

  parts.push(`<p>Thank you.</p>`);
  parts.push(`</speak>`);

  return {
    buf: Buffer.from(parts.join('\n'), 'utf8'),
    contentType: 'application/ssml+xml; charset=utf-8',
  };
}
