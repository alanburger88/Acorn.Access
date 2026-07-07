/**
 * INGESTION — lightweight PII/PHI pattern scanner for inbound payloads.
 *
 * Scans raw payload text (the whole document, path '$') for emails, US phone
 * numbers, SSNs, and Luhn-valid card numbers (PANs).
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const PAN_CANDIDATE_RE = /\b(?:\d[ -]?){13,16}\b/g;

export interface PiiFinding {
  path: string;
  kind: 'email' | 'phone' | 'ssn' | 'pan';
  count: number;
}

/** Luhn checksum over a digits-only string (card number validation). */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function scanPii(payload: string): PiiFinding[] {
  const emails = payload.match(EMAIL_RE)?.length ?? 0;
  const ssns = payload.match(SSN_RE)?.length ?? 0;
  // SSN-shaped strings also look phone-like; strip them before counting
  // phones so an SSN is never double-reported as a phone number.
  const withoutSsns = payload.replace(SSN_RE, ' ');
  const phones = withoutSsns.match(PHONE_RE)?.length ?? 0;
  const pans = (payload.match(PAN_CANDIDATE_RE) ?? []).filter((candidate) => {
    const digits = candidate.replace(/[ -]/g, '');
    return digits.length >= 13 && digits.length <= 16 && luhn(digits);
  }).length;

  const findings: PiiFinding[] = [];
  if (emails > 0) findings.push({ path: '$', kind: 'email', count: emails });
  if (phones > 0) findings.push({ path: '$', kind: 'phone', count: phones });
  if (ssns > 0) findings.push({ path: '$', kind: 'ssn', count: ssns });
  if (pans > 0) findings.push({ path: '$', kind: 'pan', count: pans });
  return findings;
}
