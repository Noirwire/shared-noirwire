import type { PieSlice } from "./wallet.js";

export const MAX_SLICES = 10;

/**
 * The smallest order a pie places. Below it the network fee and the venue's
 * minimum charge eat a visible share of the order, so the money stays as cash
 * instead of being split into dust.
 */
export const MIN_LEG_USD = 1;

/** How far, in percentage points, a slice may sit from its target before the pie offers a rebalance. */
export const REBALANCE_DRIFT = 2;

/** Whole-percent weights as even as integers allow, the remainder going to the first slices. */
export function evenSplit(symbols: string[]): PieSlice[] {
  const base = Math.floor(100 / symbols.length);
  const extra = 100 - base * symbols.length;
  return symbols.map((symbol, index) => ({ symbol, weight: base + (index < extra ? 1 : 0) }));
}

export type SliceState = PieSlice & {
  amount: number;
  value: number;
  /** Share of the pie's invested value, in percent. */
  actual: number;
};

export function needsRebalance(slices: SliceState[]) {
  return (
    slices.some((slice) => slice.value > 0) &&
    slices.some((slice) => Math.abs(slice.actual - slice.weight) >= REBALANCE_DRIFT)
  );
}

/** One order a pie action places: dollars to spend on a buy, tokens to sell on a sell. */
export type Leg = { side: "buy" | "sell"; symbol: string; amount: number; usd: number };

const cents = (value: number) => Math.floor(value * 100) / 100;

/**
 * Splits `cash` across the slices so the pie ends as close to its targets as
 * the money allows: each slice receives in proportion to how far it sits
 * below its target once the new cash is counted. An empty pie therefore
 * splits exactly by weight, and a drifted one tops up the laggards first,
 * without selling anything.
 *
 * Those shortfalls always add up to at least `cash`, because the targets add
 * up to the old value plus the new cash. Amounts round down to the cent, so
 * the legs never spend more than was offered.
 */
export function planInvest(
  cash: number,
  slices: Pick<SliceState, "symbol" | "weight" | "value">[],
) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) + cash;
  const shortfalls = slices.map((slice) => Math.max((total * slice.weight) / 100 - slice.value, 0));
  const shortfall = shortfalls.reduce((sum, value) => sum + value, 0);
  if (!(cash > 0) || shortfall <= 0) return [];
  return slices
    .map((slice, index) => {
      const usd = cents((cash * shortfalls[index]) / shortfall);
      return { side: "buy" as const, symbol: slice.symbol, amount: usd, usd };
    })
    .filter((leg) => leg.usd >= MIN_LEG_USD)
    .sort((a, b) => b.usd - a.usd);
}

/**
 * The first half of a rebalance: sell what sits above target, in tokens,
 * never more than is held. The buys are planned only after these land, from
 * the cash they actually returned, because a sell's proceeds are a forecast
 * until it settles.
 */
export function planRebalanceSells(slices: SliceState[]): Leg[] {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return slices
    .map((slice) => {
      const usd = slice.value - (total * slice.weight) / 100;
      const unitPrice = slice.amount > 0 ? slice.value / slice.amount : 0;
      const amount = unitPrice > 0 ? Math.min(usd / unitPrice, slice.amount) : 0;
      return { side: "sell" as const, symbol: slice.symbol, amount, usd };
    })
    .filter((leg) => leg.usd >= MIN_LEG_USD && leg.amount > 0)
    .sort((a, b) => b.usd - a.usd);
}
