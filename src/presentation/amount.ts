import { activityCopy } from "../copy/activity.js";
import { commonCopy } from "../copy/common.js";
import { shares, symbolAmount } from "../domain/format.js";

/** An amount as it is held, in the units the app shows, or undefined while that is not known. */
export type ShownUnits = (symbol: string, held: number) => number | undefined;

/**
 * A held amount as the product shows it, not as the chain stores it: a
 * stock's raw amount scaled by its issuer multiplier, SOL and USDC unchanged.
 * "Unavailable" while that cannot be shown truthfully yet (an unknown
 * multiplier), never the raw figure as a fallback.
 */
export function shownAmountWith(units: ShownUnits, symbol: string, held: number): string {
  const shown = units(symbol, held);
  return shown === undefined ? commonCopy.unavailable : symbolAmount(symbol, shown);
}

/**
 * The amount an activity entry moved, in its own unit and as it read on the
 * day: a tracker in shares to four decimals, cash with two like everywhere
 * else. A tracker entry from before shown amounts were recorded only has its
 * raw token count, and says so rather than passing it off as a share count.
 */
export function activityAmountOf(
  entry: { symbol: string; amount: number; shown?: number },
  isPosition: boolean,
): string {
  if (typeof entry.shown === "number") return `${shares(entry.shown)} ${entry.symbol}`;
  const amount = symbolAmount(entry.symbol, entry.amount);
  return isPosition ? activityCopy.rawTokens(amount) : amount;
}
