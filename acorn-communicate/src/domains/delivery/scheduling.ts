/**
 * DELIVERY bounded context — pure scheduling math for quiet hours and
 * frequency-cap deferrals.
 *
 * Simplification: quiet hours are evaluated in UTC. Production evaluates the
 * window in the customer's locale timezone (Customer.locale → IANA zone); the
 * reference build keeps the math timezone-free so it is deterministic in tests.
 */

export interface QuietHoursWindow {
  /** 'HH:MM' 24h, e.g. '21:00' */
  start: string;
  /** 'HH:MM' 24h, e.g. '08:00' — may be earlier than start (wraps midnight) */
  end: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Parse 'HH:MM' to minutes since midnight. Returns undefined on malformed input. */
function parseHHMM(value: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return undefined;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

/** Start of the UTC day containing `nowMs`. */
function utcMidnight(nowMs: number): number {
  return nowMs - (nowMs % DAY_MS);
}

/** Minutes since UTC midnight for `nowMs`. */
function utcMinuteOfDay(nowMs: number): number {
  return Math.floor((nowMs - utcMidnight(nowMs)) / MINUTE_MS);
}

/**
 * Is the UTC time-of-day of `nowMs` inside the quiet-hours window?
 * The window may wrap midnight (e.g. 21:00→08:00). A degenerate window
 * (start === end, or malformed times) is treated as "no quiet hours".
 */
export function inQuietHours(nowMs: number, window: QuietHoursWindow): boolean {
  const start = parseHHMM(window.start);
  const end = parseHHMM(window.end);
  if (start === undefined || end === undefined || start === end) return false;
  const minute = utcMinuteOfDay(nowMs);
  if (start < end) return minute >= start && minute < end; // same-day window
  return minute >= start || minute < end; // wraps midnight
}

/**
 * Epoch ms of the quiet-hours window end: the next occurrence of `end`
 * (today in UTC, or tomorrow when today's end time is already behind us —
 * which is exactly the wrapped-window case, e.g. 23:00 inside 21:00→08:00).
 */
export function quietHoursEnd(nowMs: number, window: QuietHoursWindow): number {
  const end = parseHHMM(window.end) ?? 0;
  const endToday = utcMidnight(nowMs) + end * MINUTE_MS;
  return endToday > nowMs ? endToday : endToday + DAY_MS;
}

/** Epoch ms of the next UTC midnight after `nowMs` (frequency-cap deferral target). */
export function nextUtcMidnight(nowMs: number): number {
  return utcMidnight(nowMs) + DAY_MS;
}

/** Do two instants fall on the same UTC calendar date? */
export function sameUtcDay(aMs: number, bMs: number): boolean {
  return utcMidnight(aMs) === utcMidnight(bMs);
}
