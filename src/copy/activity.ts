import type { ActivityKind } from "../domain/wallet.js";

/** The record of money moves and trades. */
export const activityCopy = {
  title: "Activity",
  filters: {
    all: "All",
    funding: "Money in",
    transfers: "Money sent",
    trades: "Trades",
  },
  entry: (kind: ActivityKind, symbol: string) => {
    switch (kind) {
      case "fund":
        return "Money arrived";
      case "send":
        return "Sent";
      case "buy":
        return `Bought ${symbol}`;
      case "sell":
        return `Sold ${symbol}`;
    }
  },
  /** The desktop table's wording, which capitalises its first letter by style. */
  tableEntry: (kind: ActivityKind, symbol: string) =>
    kind === "fund" ? "Money arrived" : kind === "send" ? "Sent" : `${kind} ${symbol}`,
  empty: "Your buys, sells and money moves will appear here.",
  noMatch: "Nothing matches that filter.",
  tableLabel: "Activity table",
  columns: {
    activity: "Activity",
    portfolio: "Portfolio",
    date: "Date",
    quantity: "Quantity",
    value: "Value",
  },
  portfolioFallback: "Portfolio",
  notPriced: "Not priced",
  /** A stock amount recorded before shown amounts were, which is a count of raw tokens. */
  rawTokens: (amount: string) => `${amount} (raw tokens)`,
} as const;
