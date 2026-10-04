/**
 * Paces requests so that no more than a set number start in any second,
 * evenly spaced, however many callers ask at once. Limiting how many are in
 * flight does not do that: fast answers let a burst through, and a service
 * that counts requests per second then refuses the lot.
 *
 * The rate it starts with is a guess at what the service allows. When the
 * service refuses a request for coming too fast, the caller says so with
 * `slowDown`, and the pace halves: a service that allows half as much is
 * then met after one refusal, not fought request by request.
 */
export type Pacer = {
  /** Resolves when the caller may start its request. Callers are served in the order they asked. */
  turn(): Promise<void>;
  /**
   * The service refused a request for coming too fast. Nothing starts for
   * `holdMs`, and from then on requests start half as often, down to a
   * quarter of the rate the pacer began with. Refusals that arrive during
   * the hold are of requests already on their way and slow nothing further.
   */
  slowDown(holdMs: number): void;
  /**
   * Nothing starts for `holdMs`, at the rate it has: for a service that is
   * still refusing after the pace was already slowed, because an allowance
   * counted over a longer time is spent and has to be waited out.
   */
  hold(holdMs: number): void;
};

export type PacerOptions = {
  /** The most requests that may start in a second. */
  perSecond: number;
  /** The clock, in milliseconds. The device's when left out. */
  now?: () => number;
  /** Waits `ms`. A timer when left out. */
  sleep?: (ms: number) => Promise<void>;
};

/** How far below its starting rate a pacer may be slowed. */
const SLOWEST_SHARE = 4;

const timer = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPacer({ perSecond, now = Date.now, sleep = timer }: PacerOptions): Pacer {
  const slowestSpacingMs = (1_000 / perSecond) * SLOWEST_SHARE;
  let spacingMs = 1_000 / perSecond;
  let nextAt = Number.NEGATIVE_INFINITY;
  let heldUntil = Number.NEGATIVE_INFINITY;
  return {
    async turn() {
      const asked = now();
      const startsAt = Math.max(asked, nextAt);
      nextAt = startsAt + spacingMs;
      if (startsAt > asked) await sleep(startsAt - asked);
    },
    slowDown(holdMs) {
      const at = now();
      if (at < heldUntil) return;
      spacingMs = Math.min(spacingMs * 2, slowestSpacingMs);
      heldUntil = at + holdMs;
      nextAt = Math.max(nextAt, heldUntil);
    },
    hold(holdMs) {
      heldUntil = Math.max(heldUntil, now() + holdMs);
      nextAt = Math.max(nextAt, heldUntil);
    },
  };
}
