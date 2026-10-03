import type { Catalog } from "./catalog.js";
import { MAX_SLICES, type SliceState } from "../domain/pie.js";
import type { Portfolio, PieSlice } from "../domain/wallet.js";

/** Why a mix cannot be saved. */
export type PieProblem =
  | { reason: "empty" }
  | { reason: "tooMany"; max: number }
  | { reason: "repeated" }
  | { reason: "unlisted" }
  | { reason: "retired"; symbol: string }
  | { reason: "weight" }
  | { reason: "total"; total: number };

/** A pie's mix and slices, by the listing and prices `catalog` reads. */
export function createPieReads(catalog: Pick<Catalog, "isLivePrice" | "price" | "listedStock">) {
  const { isLivePrice, price } = catalog;
  const stockBySymbol = catalog.listedStock;

  /** Why a mix cannot be saved, or null when it can. */
  function pieProblem(slices: PieSlice[]): PieProblem | null {
    if (slices.length === 0) return { reason: "empty" };
    if (slices.length > MAX_SLICES) return { reason: "tooMany", max: MAX_SLICES };
    if (new Set(slices.map((slice) => slice.symbol)).size !== slices.length) {
      return { reason: "repeated" };
    }
    if (slices.some((slice) => !stockBySymbol(slice.symbol))) return { reason: "unlisted" };
    const retired = slices.find((slice) => stockBySymbol(slice.symbol)?.retired);
    if (retired) return { reason: "retired", symbol: retired.symbol };
    if (slices.some((slice) => !Number.isInteger(slice.weight) || slice.weight < 1)) {
      return { reason: "weight" };
    }
    const total = slices.reduce((sum, slice) => sum + slice.weight, 0);
    return total === 100 ? null : { reason: "total", total };
  }

  /** Each slice as it stands: what is held, what it is worth, and its share of the pie. */
  function pieSlices(portfolio: Portfolio): SliceState[] {
    const held = (portfolio.pie ?? []).map((slice) => {
      const amount =
        portfolio.holdings.find((holding) => holding.symbol === slice.symbol)?.amount ?? 0;
      return { ...slice, amount, value: amount * price(slice.symbol) };
    });
    const total = held.reduce((sum, slice) => sum + slice.value, 0);
    return held.map((slice) => ({ ...slice, actual: total > 0 ? (slice.value / total) * 100 : 0 }));
  }

  /** Every slice the pie holds has a live price, so values and drift are real figures. */
  function piePriced(portfolio: Portfolio, updatedAt: number | null) {
    return pieSlices(portfolio).every(
      (slice) => slice.amount <= 0 || (updatedAt !== null && isLivePrice(slice.symbol)),
    );
  }

  return { pieProblem, pieSlices, piePriced };
}
