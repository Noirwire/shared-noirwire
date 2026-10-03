import { shownUnits, isPosition } from "./market.js";
import { activityAmountOf, shownAmountWith } from "../presentation/amount.js";
import type { Activity } from "../domain/wallet.js";

/** A held amount as shown at the multipliers known right now. */
export function shownAmount(symbol: string, held: number): string {
  return shownAmountWith(shownUnits, symbol, held);
}

/** An activity entry's amount as it read on the day. */
export function activityAmount(entry: Pick<Activity, "symbol" | "amount" | "shown">): string {
  return activityAmountOf(entry, isPosition(entry.symbol));
}
