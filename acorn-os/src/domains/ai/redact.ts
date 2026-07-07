/**
 * PII redaction helpers for the AI GATEWAY bounded context.
 *
 * Applied to outbound text (e.g. questions forwarded to an external LLM
 * provider) so that raw customer PII never leaves the platform boundary.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

/** Mask email addresses and SSN-shaped numbers with '[redacted]'. */
export function redactPii(text: string): string {
  return text.replace(EMAIL_RE, '[redacted]').replace(SSN_RE, '[redacted]');
}
