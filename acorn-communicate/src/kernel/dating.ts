/**
 * Content effective/expiry dating helpers.
 *
 * A dated entity carries an optional effective window [effectiveFrom, expiresAt).
 * It is "currently effective" when:
 *   (no effectiveFrom OR effectiveFrom <= now) AND (no expiresAt OR now < expiresAt)
 * i.e. effectiveFrom is inclusive and expiresAt is exclusive.
 *
 * These are pure helpers shared by the content and translations bounded
 * contexts so the enforcement rule lives in exactly one place. Callers pass an
 * explicit `now` (epoch millis) so the check is deterministic/testable; the
 * production enforcement points pass a wall-clock Date.now() (see getByKey).
 */
import { invalid } from './errors.js';

/** True when `now` falls inside the [effectiveFrom, expiresAt) window (unset bounds = open). */
export function isWindowEffective(
  effectiveFrom: string | undefined,
  expiresAt: string | undefined,
  now: number,
): boolean {
  if (effectiveFrom && new Date(effectiveFrom).getTime() > now) return false; // not yet effective
  if (expiresAt && now >= new Date(expiresAt).getTime()) return false; // expired
  return true;
}

/** Validate that effectiveFrom is on or before expiresAt when both are present. */
export function assertDateWindow(effectiveFrom?: string, expiresAt?: string): void {
  if (
    effectiveFrom &&
    expiresAt &&
    new Date(effectiveFrom).getTime() > new Date(expiresAt).getTime()
  ) {
    throw invalid('effectiveFrom must be on or before expiresAt');
  }
}
