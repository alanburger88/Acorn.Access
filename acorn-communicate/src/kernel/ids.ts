import { randomBytes } from 'node:crypto';

/** Crockford base32 alphabet used by ULID. */
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = 0;
let lastRand: number[] = [];

/**
 * Monotonic-within-process ULID (26 chars, lexicographically sortable).
 * Within the same millisecond the previous random part is incremented rather
 * than regenerated, so ids created later always sort later — "latest record
 * wins" logic can safely tie-break on id.
 */
export function ulid(now: number = Date.now()): string {
  if (now === lastTime && lastRand.length === 16) {
    for (let i = 15; i >= 0; i--) {
      if (lastRand[i]! < 31) {
        lastRand[i]!++;
        break;
      }
      lastRand[i] = 0; // carry (overflow across all 16 chars is not a practical concern)
    }
  } else {
    lastTime = now;
    lastRand = Array.from(randomBytes(16), (b) => b % 32);
  }
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENC[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + lastRand.map((v) => ENC[v]).join('');
}

/**
 * Prefixed entity id, e.g. `com_01J9Z...`. Prefix conventions are defined in
 * platform/05-data-models.md (ten_, ws_, brd_, usr_, key_, cus_, cnt_, cnv_,
 * tpl_, tpv_, com_, art_, dlv_, lnk_, evt_, act_, rec_, arc_, whk_, aii_, ing_).
 */
export function newId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

/** URL-safe opaque secret token (for API keys and secure links). */
export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
