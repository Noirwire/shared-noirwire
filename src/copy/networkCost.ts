import type { Opens } from "../domain/networkCost.js";

/**
 * The network cost of a money review. The network charges in its own
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

  /** The sentence before and after the link that takes the user to move money in. */
  needsCash: (cash: string, underOneCent: boolean, free: string) =>
    `This portfolio needs ${underOneCent ? "" : "at least "}${cash} of cash to pay the network cost, and would have ${free} to spare. `,
  moveMoneyHere: "Move money here",
  orSmaller: " or use a smaller amount.",

  tooSmall: (smallest: string) => `The smallest order right now is about ${smallest}.`,

  /** The disclosure under a cost the relayer pays. */
  relayer: {
    summary: (fee: string) => `Network cost: ${fee}. What is this?`,
    paysBack: (exactFee: string) =>
      `Every action has a small network cost. NoirWire's relayer pays it, and this portfolio pays the relayer back exactly ${exactFee} USDC, `,
    fromCash: "from its cash",
    fromWithdrawal: "out of the USDC this withdrawal returns",
    sameTransaction: ", in the same transaction.",
    openedFirst:
      ". The account is opened first, then your order is priced and placed, with one confirmation.",
    openedFirstSeveral:
      ". The accounts are opened first, then your orders are priced and placed, with one confirmation.",
    movesWithMarket:
      " The cost moves with the market: if it has risen by the time you confirm, nothing is sent and you are shown the new cost first. A transaction paid this way shows publicly that this portfolio uses NoirWire. It does not show your funding wallet or your other portfolios.",
  },

  /** The line a review shows when it states the cost in a sentence of its own. */
  line: (figure: string) => `Network cost: ${figure}`,

  alreadyCovered: "The network cost is already paid, so you can try again at no further cost.",
} as const;
