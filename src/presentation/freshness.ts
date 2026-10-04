import { marketsCopy } from "../copy/markets.js";
import { portfolioCopy } from "../copy/portfolio.js";
import { commonCopy } from "../copy/common.js";
import { freshnessOf, hasLoaded, type ReadFreshness } from "../domain/freshness.js";

/**
 * What a screen is told about how current its reads are. `now` is the
 * moment the screen is drawn for; each platform owns its clock. An app
 * keeps one `ReadFreshness` per read with `recordRead`, from the result its
 * refresh already answers with.
 */
export type ScreenFreshness = {
  now: number;
  /** Live prices: `livePricesFreshness()` from the price feed. */
  prices: ReadFreshness;
};

/** Home also shows balances, read by the app's own refresh. */
export type HomeFreshness = ScreenFreshness & { balances: ReadFreshness };

/**
 * A tracker's page also shows a chart, read once for each range, and what
 * the wallet holds of the tracker. A visitor has no balances: pass `NEVER_READ`.
 */
export type TrackerFreshness = ScreenFreshness & { chart: ReadFreshness; balances: ReadFreshness };

export type FreshnessView = {
  /** The quiet "may be out of date" notice, or null while everything shown is current. */
  stale: string | null;
  /** Nothing has been read yet and nothing has failed: the screen waits, and says nothing. */
  loading: boolean;
};

/** Balances could not be loaded at all: the one line a screen says, and its retry. */
export type UnavailableView = { text: string; retry: string };

/**
 * A figure worked out from balances. Null until they have been read once:
 * there is nothing to show, and a screen draws nothing, never a zero.
 */
export type Figure = string | null;

export type BalancesView = {
  /** The balances came back at least once: figures can be shown. */
  known: boolean;
  /** The first read is still under way: the screen waits. */
  loading: boolean;
  /** The first read failed: figures are null and this line is shown, with its retry. */
  unavailable: UnavailableView | null;
  /** Why an action that needs a known balance cannot be pressed, or null when it can. */
  reason: string | null;
};

/**
 * Whether anything read from balances can be shown. Never loaded and failed
 * is `unavailable`; never loaded and still asking is `loading`; loaded once
 * is `known`, however old (its age is `freshnessView`'s to say).
 */
export function balancesView(read: ReadFreshness): BalancesView {
  const known = hasLoaded(read);
  const failed = !known && read.lastAttemptFailed;
  return {
    known,
    loading: !known && !failed,
    unavailable: failed ? balancesUnavailable() : null,
    reason: failed ? portfolioCopy.balances.unavailable : null,
  };
}

/** The line and the retry for balances that never loaded, for a sheet that makes its own read. */
export function balancesUnavailable(): UnavailableView {
  return { text: portfolioCopy.balances.unavailable, retry: commonCopy.tryAgain };
}

type Notice = "balances" | "prices";

const NOTICE: Record<Notice, string> = {
  balances: portfolioCopy.balances.stale,
  prices: marketsCopy.stale,
};

/**
 * The one rule for every screen (`freshnessOf`). The first read that may be
 * out of date names the notice; with none, the screen is loading while any
 * read has never come back.
 */
export function freshnessView(
  now: number,
  reads: readonly { read: ReadFreshness; notice: Notice; readOnce?: boolean }[],
): FreshnessView {
  // A read made once and not repeated (a chart) does not age: only its own failure makes it stale.
  const states = reads.map(({ read, notice, readOnce }) => ({
    state: freshnessOf(read, readOnce ? (read.succeededAt ?? now) : now),
    notice,
  }));
  const stale = states.find(({ state }) => state === "stale");
  return {
    stale: stale ? NOTICE[stale.notice] : null,
    loading: !stale && states.some(({ state }) => state === "waiting"),
  };
}
