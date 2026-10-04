import { plural } from "./plural.js";
import { stillWorkingOnAction } from "./waiting.js";

function list(items: readonly string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Buying and selling a tracker, and what every buy says about what it is. */
export const tradeCopy = {
  title: (side: "buy" | "sell", trackerName: string | null) =>
    `${side === "buy" ? "Buy" : "Sell"} ${trackerName === null ? "an investment" : `${trackerName} tracker`}`,
  issuerLine: (symbol: string, issuer: string | undefined) =>
    `${symbol}${issuer ? ` · ${issuer}` : ""}`,

  investment: "Investment",
  choose: "Choose",
  chooseInvestment: "Choose investment",
  portfolioLabel: (side: "buy" | "sell") => `${side === "buy" ? "Buy in" : "Sell from"} portfolio`,
  amountIn: "Amount in",
  inDollars: "Amount in dollars",
  inTokens: (symbol: string) => `${symbol} tokens`,
  spend: "Spend $",
  receiveAbout: "Receive about $",
  sellAll: "Sell all",
  estimate: (figure: string | null) => `Estimate: ${figure ?? "at review"}`,
  available: (figure: string) => `Available ${figure}`,
  estimateBasis: (live: boolean) =>
    `${live ? "Estimate uses a live display price." : "No live price to estimate with."} Your order price is shown at review.`,
  moreThanReady: "More than this portfolio has to invest.",
  moreThanHeld: "More than this portfolio holds.",
  addMoney: "Add money",
  gettingPrice: "Getting a live price...",
  review: (side: "buy" | "sell") => `Review ${side}`,
  priceAboveReady:
    "The live price is more than this portfolio has to invest. Enter a smaller amount.",
  costCheckFailed:
    "We couldn't work out the network cost of this order. Nothing was charged. Get a new price.",

  reviewLead: (portfolio: string) =>
    `Review this live quote before moving funds from ${portfolio}. USDC is shown as dollars.`,
  terms: {
    youPay: "You pay",
    youReceive: "You expect to receive",
    price: "Price for this order",
    fee: "Fee",
    ofWhichNoirWire: "Of which NoirWire",
    networkCost: "Network cost",
    quotedBy: "Quoted by",
    minimum: "Minimum you will receive",
  },
  usdc: (dollars: string) => `${dollars} USDC`,
  perToken: (price: string, symbol: string) => `${price} per ${symbol}`,
  feeUnknown: "Unknown",
  feeTotal: (percent: string, dollars: string) => `${percent}% total · about ${dollars}`,
  percent: (percent: string) => `${percent}%`,
  stopsBelowMinimum: "If this order would deliver less than the minimum, we will stop it.",
  priceUnchecked:
    "No live price was available to compare this quote against. Check the price per token above before you confirm.",
  feesTitle: "Fees and price difference",
  feeUnverified:
    "The fee for this quote could not be verified. Get another price before confirming.",
  feeCoversNetwork:
    "The fee above is already inside the quoted amounts and also covers the network cost. On small orders it is a larger share of the total.",
  feeOpeningSeparate:
    "The fee above is already inside the quoted amounts. Opening a holding for the first time has a network cost of its own, shown above.",
  feeNetworkSeparate:
    "The fee above is already inside the quoted amounts. The network cost of this order is separate, shown above.",
  noFundingFee:
    "No private move fee is part of this trade. Moving money into a portfolio is a separate action.",
  notFirm:
    "This is a live price, not yet a firm order. The order is priced once the account for it is open, and placed only if it is no worse than shown here. If the price has moved against you by then, you are shown the new one and asked again.",
  expired: "This price expired. Get a new price to continue.",
  expiresAt: (time: string) => `Quote expires at ${time}.`,
  newPrice: "Get a new price",
  openingAccount: "Opening the account...",
  submitting: "Submitting order...",
  confirm: (side: "buy" | "sell") => `Confirm ${side}`,

  tracker: {
    title: "What you are buying",
    what: (symbols: readonly string[]) =>
      symbols.length === 1
        ? `${symbols[0]} is an xStocks tracker certificate, not a company or ETF share. It has no voting rights. The issuer can freeze it or move or burn tokens without your signature.`
        : `${list(symbols)} are xStocks tracker certificates, not company or ETF shares. They have no voting rights. The issuer can freeze them or move or burn tokens without your signature.`,
    notOffered:
      "xStocks are not offered in the United States, to US persons or in the issuer's prohibited countries.",
  },
  publicTrade:
    "Your trade, amount and timing are public. A private move can reduce the link to your funding wallet; it does not hide this trade.",

  chooseTracker: (side: "buy" | "sell") => `${side === "buy" ? "Buy" : "Sell"} a tracker`,
  trackerLabel: "Tracker",
  whichPortfolio: (side: "buy" | "sell") =>
    side === "buy" ? "Which portfolio buys it?" : "Which portfolio sells it?",
  cashAvailable: (amount: string) => `${amount} available`,
  held: (amount: string) => `${amount} held`,
  continueWith: (label: string) => `Continue with ${label}`,
  smallestOrder: (smallest: string) =>
    `The smallest order is about ${smallest} USDC. Your order price is shown at review.`,
  belowSmallest: (smallest: string) => `The smallest order is about ${smallest} USDC.`,
  noLiveToConvert: "No live price to convert with.",
  /** Buying from a portfolio with nothing to invest, said on the first tap. */
  noMoney: "No money in this portfolio yet",
  noMoneyAnywhere: "No money in your portfolios yet",
  noMoneyDetail: "Move money into this portfolio first.",

  headline: {
    spend: (dollars: string, portfolio: string) => `Spend ${dollars} from ${portfolio}`,
    sell: (amount: string, portfolio: string) => `Sell ${amount} from ${portfolio}`,
    receiveAtLeast: (amount: string) => `Receive at least ${amount}`,
  },
  heldFor: (seconds: number) => `Price held for ${plural(seconds, "second")}.`,
  totalCost: "Total cost",
  totalReceive: "Total you receive, at least",
  includedInFee: "Included in the fee",
  alreadyPaid: "Already paid",
  alreadyPaidReason: "The holding is open. The network cost for that is already paid.",
  whatIsCost: "What is the network cost?",
  trackerLine: (symbol: string) => `${symbol} is a tracker, not a share.`,
  readRisks: "Read the risks",
  risksTitle: "Risks",
  publicLine: "This portfolio's trades and holdings are public.",
  nothingTraded: "Nothing was traded.",
  priceMovedReview:
    "The price moved before this order could be placed. Nothing was traded. Review the new price.",

  progress: {
    title: (side: "buy" | "sell") =>
      side === "buy" ? "Checking your purchase" : "Checking your sale",
    opening: (symbol: string) => `Opening the holding for ${symbol}`,
    opened: "The holding is open. The network cost for that is already paid.",
    pricing: "Getting the price for your order",
    placing: "Placing the order",
    reading: "Reading the new balance",
    stillWorking: stillWorkingOnAction,
  },

  result: {
    bought: (amount: string) => `Bought ${amount}`,
    sold: (amount: string) => `Sold ${amount}`,
    boughtFor: (dollars: string, portfolio: string) => `For ${dollars}, in ${portfolio}.`,
    soldFor: (dollars: string, portfolio: string) =>
      `For ${dollars}, now in ${portfolio}, ready to invest.`,
    placed: "Order placed",
    placedUnread: "The new balance could not be read yet and will appear shortly.",
    unknown: "Sent, but not confirmed",
    unknownBody: (portfolio: string) =>
      `This was sent but could not be confirmed. It may still go through. Check ${portfolio}'s balance before trying again.`,
    notPlaced: "Order not placed",
    notPlacedBody:
      "The holding is open. The network cost for that is already paid and cannot be returned. Nothing else was charged, and placing the order again has no further network cost.",
    reviewNewPrice: "Review a new price",
    done: "Done",
    close: "Close",
  },
} as const;

/** What the phone says differently on the trade sheet. Everything else is `tradeCopy`. */
export const mobileTradeCopy = {
  offline: "You're offline. Nothing can be confirmed until you're back online.",
} as const;
