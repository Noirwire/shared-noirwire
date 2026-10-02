import type { Opens } from "../domain/networkCost.js";

/**
 * The network cost row of a money review. The network charges in its own
 * currency; the portfolio's cash pays it, so nobody has to hold or name that
 * currency, and none of the wording here does.
 */
export const networkCostCopy = {
  label: "Network cost",
  covered: "Covered",
  underOneCent: "less than 0.01 USDC",
  notAvailable: "Not available",
  checking: "Checking...",

  /** Nothing was charged, and nothing is asked for. */
  notNow: "This can't be done right now. Nothing was charged. Please try again in a few minutes.",
  noPrice: "No price is available for this right now. Try again in a moment.",

  fromOwnSol: (usd: string | null) =>
    `${usd === null ? "less than 0.01 USD" : `about ${usd} USD`}, paid from this portfolio's SOL balance`,

  opening: {
    recipient:
      "The network cost includes opening the recipient's account for this token, a one-time cost.",
    earn: "The network cost includes opening this portfolio's account for Earn, a one-time cost.",
    holding:
      "The network cost includes opening this portfolio's account for this tracker, a one-time cost.",
    cash: "The network cost includes opening this portfolio's account for USDC, a one-time cost.",
  } satisfies Record<Opens, string>,

  openingSeveral: (count: number) =>
    `The network cost includes opening this portfolio's accounts for ${count} trackers, a one-time cost.`,

  needsCash: (cash: string, underOneCent: boolean, free: string) =>
    `This portfolio needs ${underOneCent ? "" : "at least "}${cash} of cash to pay the network cost, and would have ${free} to spare. Move money into this portfolio or use a smaller amount.`,

  tooSmall: (smallest: string) => `The smallest order right now is about ${smallest}.`,
} as const;
