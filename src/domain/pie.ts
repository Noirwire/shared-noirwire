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

/** A pie's mix while it is built or edited. */
export type Mix = {
  slices: PieSlice[];
  /** While true, the mix stays an even split as trackers come and go. */
  even: boolean;
};

export type MixChange =
  | { type: "add"; symbol: string }
  | { type: "remove"; symbol: string }
  | { type: "set"; symbol: string; weight: number }
  | { type: "splitEvenly" };

export function isEvenSplit(slices: readonly PieSlice[]) {
  if (slices.length === 0) return true;
  const even = evenSplit(slices.map((slice) => slice.symbol));
  return even.every((slice, index) => slice.weight === slices[index].weight);
}

/** The mix a builder opens with: the stored one, or nothing. */
export function mixFrom(slices: readonly PieSlice[] | undefined): Mix {
  const copied = (slices ?? []).map((slice) => ({ ...slice }));
  return { slices: copied, even: isEvenSplit(copied) };
}

/** A typed target is a whole number from 0 to 100. */
export function wholePercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * One change to a mix. An even mix stays even as trackers are added and
 * removed; setting a target by hand ends that, and "split evenly" starts it
 * again. A mix never holds more than `MAX_SLICES` trackers or one twice.
 */
export function changeMix(mix: Mix, change: MixChange): Mix {
  const symbols = mix.slices.map((slice) => slice.symbol);
  switch (change.type) {
    case "add":
      if (symbols.includes(change.symbol) || symbols.length >= MAX_SLICES) return mix;
      return mix.even
        ? { slices: evenSplit([...symbols, change.symbol]), even: true }
        : { slices: [...mix.slices, { symbol: change.symbol, weight: 0 }], even: false };
    case "remove": {
      const rest = mix.slices.filter((slice) => slice.symbol !== change.symbol);
      return mix.even
        ? { slices: evenSplit(rest.map((slice) => slice.symbol)), even: true }
        : { ...mix, slices: rest };
    }
    case "set":
      return {
        even: false,
        slices: mix.slices.map((slice) =>
          slice.symbol === change.symbol
            ? { ...slice, weight: wholePercent(change.weight) }
            : slice,
        ),
      };
    case "splitEvenly":
      return { slices: evenSplit(symbols), even: true };
  }
}

type ValuedSlice = Pick<SliceState, "symbol" | "weight" | "value">;

/**
 * The share of `cash` each slice would receive, by the same rule the split
 * itself uses: in proportion to how far each sits below its target once the
 * new cash is counted.
 */
function splitShares(cash: number, slices: readonly ValuedSlice[]): number[] {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) + cash;
  const shortfalls = slices.map((slice) => Math.max((total * slice.weight) / 100 - slice.value, 0));
  const sum = shortfalls.reduce((acc, value) => acc + value, 0);
  return sum > 0 ? shortfalls.map((value) => value / sum) : [];
}

/**
 * The least that can be invested in this mix right now so every order of the
 * split reaches the smallest order the venue places, rounded up to the next
 * dollar; null when `cash` already does. Approximate by nature: the real
 * answer comes with the quotes.
 */
export function investFloor(
  cash: number,
  slices: readonly ValuedSlice[],
  smallest: number,
): number | null {
  if (!(cash > 0)) return null;
  const shares = splitShares(cash, slices).filter((share) => share > 0);
  if (shares.length === 0) return null;
  const least = Math.min(...shares);
  if (cash * least >= smallest) return null;
  return Math.ceil(smallest / least);
}

/**
 * A rebalance sells only what sits above target by at least the smallest
 * order, never more than is held. `leftAlone` says whether smaller
 * differences were skipped.
 */
export function rebalanceSells(slices: SliceState[], smallest: number) {
  const all = planRebalanceSells(slices);
  const sells = all.filter((leg) => leg.usd >= smallest);
  return { sells, leftAlone: sells.length < all.length };
}
