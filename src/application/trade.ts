import { tooPrecise, typedAmount } from "../domain/amount.js";
import type { Side } from "../domain/order.js";

/** What a trade is typed in: dollars, or the tracker's own tokens. */
export type Denomination = "cash" | "units";

export type TradeInput = {
  side: Side;
  denom: Denomination;
  amountText: string;
  /** The portfolio's cash, in dollars. */
  cash: number;
  /** What the portfolio holds of the tracker, as stored. */
  heldRaw: number;
  /** Shown units per stored unit of the tracker, or undefined while that is not known. */
  unitsPerHeld: number | undefined;
  /** The live display price per shown unit, or 0 without one. */
  displayPrice: number;
  /** How many decimals the tracker has, for an amount typed in its tokens. Unchecked when absent. */
  decimals?: number;
};

/** The decimals of the cash a trade spends and returns, USDC. */
export const TRADE_CASH_DECIMALS = 6;

export type TradeDraft = {
  multiplierKnown: boolean;
  /** What the portfolio holds, in shown units. */
  held: number;
  valid: boolean;
  /** The amount was typed with more decimals than what it is typed in has. */
  tooPrecise: boolean;
  /** How many decimals it may have, in the denomination typed in. */
  decimals: number | undefined;
  /** The typed amount, or 0 when it is not a valid amount. */
  typed: number;
  /** The typed amount in shown units of the tracker. */
  units: number;
  /** The typed amount in dollars. */
  value: number;
  /** The most that can be typed, in the denomination typed in. */
  cap: number;
  overCap: boolean;
  /** What is asked to be quoted: dollars to spend on a buy, stored tokens to sell on a sell. */
  amountToQuote: number;
};

export function tradeDraft(input: TradeInput): TradeDraft {
  const { side, denom, cash, heldRaw, unitsPerHeld, displayPrice } = input;
  const multiplierKnown = unitsPerHeld !== undefined;
  const held = multiplierKnown ? heldRaw * unitsPerHeld : 0;
  const decimals = denom === "cash" ? TRADE_CASH_DECIMALS : input.decimals;
  const precise = decimals !== undefined && tooPrecise(input.amountText, decimals);
  const typed = precise ? 0 : typedAmount(input.amountText);
  const valid = typed > 0;
  const units = denom === "units" ? typed : displayPrice > 0 ? typed / displayPrice : 0;
  const value = denom === "cash" ? typed : typed * displayPrice;
  const cap =
    side === "buy"
      ? denom === "cash"
        ? cash
        : displayPrice > 0
          ? cash / displayPrice
          : 0
      : denom === "units"
        ? held
        : held * displayPrice;
  // Selling the full position quotes the exact stored raw amount, so
  // converting shown units back to raw leaves no rounding dust behind.
  const sellRaw = typed === cap ? heldRaw : multiplierKnown ? units / unitsPerHeld : 0;
  const amountToQuote =
    side === "buy" ? (denom === "units" && typed === cap ? cash : value) : sellRaw;
  return {
    multiplierKnown,
    held,
    valid,
    tooPrecise: precise,
    decimals,
    typed,
    units,
    value,
    cap,
    overCap: typed > cap,
    amountToQuote,
  };
}
