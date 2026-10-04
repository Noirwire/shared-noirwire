/**
 * How current a read is: balances, live prices, a chart. One rule for every
 * screen, so a figure that could not be read again is never shown as if it
 * had been.
 *
 * Each read keeps two things: when it last succeeded, and whether its most
 * recent attempt failed. A screen says its data may be out of date the
 * moment an attempt fails, or once the last success is older than
 * `STALE_AFTER_MS`, and stops saying so on the next success.
 */
export type ReadFreshness = {
  /** When the read last came back whole, or null when it never has. */
  succeededAt: number | null;
  /** Whether the most recent attempt failed. A success clears it. */
  lastAttemptFailed: boolean;
};

/** A read that has not been attempted yet. */
export const NEVER_READ: ReadFreshness = { succeededAt: null, lastAttemptFailed: false };

/** How often a screen asks again for what it shows: live prices, and the balances beside them. */
export const REFRESH_INTERVAL_MS = 30_000;

/**
 * Past this age a read counts as out of date even when no attempt was seen
 * to fail: two refresh intervals, so one refresh running late is not said,
 * and two missed ones are.
 */
export const STALE_AFTER_MS = 2 * REFRESH_INTERVAL_MS;

/**
 * The read after one more attempt. `ok` is the result a refresh already
 * answers with: true when everything came back, false when it did not.
 * `at` is when the attempt finished. A failure keeps the time of the last
 * success.
 */
export function recordRead(previous: ReadFreshness, ok: boolean, at: number): ReadFreshness {
  return ok
    ? { succeededAt: at, lastAttemptFailed: false }
    : { succeededAt: previous.succeededAt, lastAttemptFailed: true };
}

/** `waiting`: never loaded, and nothing has failed. `stale`: may be out of date. */
export type Freshness = "waiting" | "fresh" | "stale";

export function freshnessOf(read: ReadFreshness, now: number): Freshness {
  if (read.lastAttemptFailed) return "stale";
  if (read.succeededAt === null) return "waiting";
  return now - read.succeededAt > STALE_AFTER_MS ? "stale" : "fresh";
}
