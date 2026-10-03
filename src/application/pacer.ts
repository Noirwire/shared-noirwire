/**
 * Paces requests so that no more than a set number start in any second,
 * evenly spaced, however many callers ask at once. Limiting how many are in
 * flight does not do that: fast answers let a burst through, and a service
 * that counts requests per second then refuses the lot.
 */
export type Pacer = {
  /** Resolves when the caller may start its request. Callers are served in the order they asked. */
  turn(): Promise<void>;
};

export type PacerOptions = {
  /** The most requests that may start in a second. */
  perSecond: number;
  /** The clock, in milliseconds. The device's when left out. */
  now?: () => number;
  /** Waits `ms`. A timer when left out. */
  sleep?: (ms: number) => Promise<void>;
};

const timer = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPacer({ perSecond, now = Date.now, sleep = timer }: PacerOptions): Pacer {
  const spacingMs = 1_000 / perSecond;
  let nextAt = Number.NEGATIVE_INFINITY;
  return {
    async turn() {
      const asked = now();
      const startsAt = Math.max(asked, nextAt);
      nextAt = startsAt + spacingMs;
      if (startsAt > asked) await sleep(startsAt - asked);
    },
  };
}
