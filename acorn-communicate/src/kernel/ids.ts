import { randomBytes } from 'node:crypto';

/** Crockford base32 alphabet used by ULID. */
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = 0;
let counter = 0;

/** Monotonic-within-process ULID (26 chars, lexicographically sortable). */
export function ulid(now: number = Date.now()): string {
  if (now === lastTime) counter++;
  else {
    lastTime = now;
    counter = 0;
  }
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ENC[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(16);
  // fold the per-millisecond counter into the first random bytes for monotonicity
  rand[0] = (rand[0]! + counter) & 0xff;
  let out = time;
  for (let i = 0; i < 16; i++) out += ENC[rand[i]! % 32];
  return out;
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
