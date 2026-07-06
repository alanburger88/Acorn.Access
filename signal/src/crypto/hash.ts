import { createHash } from 'node:crypto';
import { canonicalBytes } from '../canonical/jcs.js';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** SHA-256 (hex) over the RFC 8785 canonical form of a JSON value. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalBytes(value));
}
