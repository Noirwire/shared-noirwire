import { marketsCopy } from "../copy/markets.js";
import { portfolioCopy } from "../copy/portfolio.js";
import { freshnessOf, type ReadFreshness } from "../domain/freshness.js";

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

/** A tracker's page also shows a chart, read once for each range. */
export type TrackerFreshness = ScreenFreshness & { chart: ReadFreshness };

export type FreshnessView = {
  /** The quiet "may be out of date" notice, or null while everything shown is current. */
  stale: string | null;
  /** Nothing has been read yet and nothing has failed: the screen waits, and says nothing. */
  loading: boolean;
};

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
