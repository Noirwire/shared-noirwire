import type { ActivityKind } from "../domain/wallet.js";

const intoEarn = "Moved into Earn";
const fromEarn = "Returned from Earn";

/** Where the record lives, and where a restored wallet starts again. */
const keptOnly = (place: string, elsewhere: string) =>
  `History is kept ${place} only. A wallet restored ${elsewhere} starts with an empty list.`;

/** Only the newest entries are kept where the wallet is: "in this browser" or "on this phone". */
const olderNotKept = (place: string) => (count: number) =>
  `Only your ${count} most recent ${count === 1 ? "entry is" : "entries are"} kept ${place}. Older ones are no longer shown here. Your money is not affected.`;

/** What the detail sheet says about where the entry was written down. */
const recordedWhere = (place: string) =>
  `Recorded ${place} when it happened. The transfer itself is public.`;

/** An imported wallet's history starts at the import. `where` is "in this browser" or "on this phone". */
const importedNote = (where: string) =>
  `This wallet was restored ${where}. Activity from before that, made on another device, is not shown here. Your balances are complete.`;

/** The record of money moves and trades. */
export const activityCopy = {
  title: "Activity",
  filters: {
    all: "All",
    funding: "Money in",
    transfers: "Money sent",
    trades: "Trades",
    earn: "Earn",
  },
  entry: (kind: ActivityKind, symbol: string) => {
    switch (kind) {
      case "deposit":
      case "fund":
        return "Money arrived";
      case "send":
        return "Sent";
      case "buy":
        return `Bought ${symbol}`;
      case "sell":
        return `Sold ${symbol}`;
      case "earnDeposit":
        return intoEarn;
      case "earnWithdraw":
        return fromEarn;
    }
  },
  /** The desktop table's wording, which capitalises its first letter by style. */
  tableEntry: (kind: ActivityKind, symbol: string) => {
    switch (kind) {
      case "deposit":
      case "fund":
        return "Money arrived";
      case "send":
        return "Sent";
      case "buy":
      case "sell":
        return `${kind} ${symbol}`;
      case "earnDeposit":
        return intoEarn;
      case "earnWithdraw":
        return fromEarn;
    }
  },
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
  movedToPortfolio: "Moved to portfolio",
  notPriced: "Not priced",
  /** A stock amount recorded before shown amounts were, which is a count of raw tokens. */
  rawTokens: (amount: string) => `${amount} (raw tokens)`,

  filtersLabel: "Show",
  bought: (tracker: string) => `Bought ${tracker}`,
  sold: (tracker: string) => `Sold ${tracker}`,
  sentCaption: (portfolio: string) => `To an address you entered · ${portfolio}`,
  today: "Today",
  yesterday: "Yesterday",
  emptyDetail: keptOnly("in this browser", "in another browser"),
  olderNotKept: olderNotKept("in this browser"),
  plus: "plus",
  minus: "minus",
  /** Under a row whose action was charged a network cost. */
  networkCost: (cost: string) => `Network cost ${cost}`,
  /**
   * On an imported wallet: what it did before was never written down here.
   * `where` is "in this browser" or "on this phone".
   */
  importedNote: importedNote("in this browser"),

  detail: {
    portfolio: "Portfolio",
    date: "Date",
    amount: "Amount",
    arrived: "Arrived",
    networkCost: "Network cost",
    valueAtTime: "Value at the time",
    sentTo: "Sent to",
    addressYouEntered: "An address you entered",
    show: "Show",
    hide: "Hide",
    copy: "Copy",
    copied: "Copied",
    showAddress: "Show the address it was sent to",
    hideAddress: "Hide the address",
    copyAddress: "Copy the address it was sent to",
    openPortfolio: (name: string) => `Open ${name}`,
    recorded: recordedWhere("in this browser"),
  },
} as const;

/** What the phone says differently on Activity. Everything else is `activityCopy`. */
export const mobileActivityCopy = {
  importedNote: importedNote("on this phone"),
  emptyDetail: keptOnly("on this phone", "on a new phone"),
  olderNotKept: olderNotKept("on this phone"),
  detail: {
    recorded: recordedWhere("on this phone"),
  },
} as const;
