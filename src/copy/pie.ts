import { plural } from "./plural.js";

/** A pie: its mix, building one, and placing its orders. */
export const pieCopy = {
  mix: {
    title: "Your mix",
    edit: "Edit mix",
    invested: "Invested",
    target: "Target",
    unpriced: "Unpriced",
    stocks: (count: number) => `${count} stocks`,
    targetShare: (weight: number) => `Target ${weight}%`,
    nowShare: (actual: string) => ` · Now ${actual}%`,
    notBought: "Not bought",
    sell: "Sell",
    sellLabel: (symbol: string) => `Sell ${symbol}`,
  },

  /** Why a mix cannot be saved. */
  problems: {
    empty: "Add at least one stock.",
    tooMany: (max: number) => `A pie holds at most ${max} stocks.`,
    repeated: "Each stock can appear once.",
    unlisted: "Only listed stocks can be added.",
    retired: (symbol: string) => `${symbol} is no longer offered to buy. Remove it from the mix.`,
    weight: "Every stock needs at least 1%.",
    total: (total: number) => `The mix adds up to ${total}%. It needs to be 100%.`,
  },

  builder: {
    nameLabel: "Pie name",
    namePlaceholder: "Core",
    total: (total: number) => `${total}%`,
    fullyAllocated: "Fully allocated",
    leftToPlace: (left: number) => `${left}% left to place`,
    over: (over: number) => `${over}% over`,
    splitEvenly: "Split evenly",
    stocksLabel: "Stocks in this pie",
    less: (symbol: string) => `Less ${symbol}`,
    more: (symbol: string) => `More ${symbol}`,
    remove: (symbol: string) => `Remove ${symbol}`,
    shareLabel: (symbol: string) => `${symbol} share in percent`,
    addAnother: "Add another stock",
    pickStocks: "Pick the stocks for this pie",
    add: "Add",
  },

  edit: {
    title: "Edit mix",
    lead: "Changing the mix places no orders. Invest and Rebalance then steer toward it, and anything you drop stays held until you sell it.",
    save: "Save mix",
    saving: "Saving...",
  },

  order: {
    investTitle: (portfolio: string) => `Invest in ${portfolio}`,
    rebalanceTitle: (portfolio: string) => `Rebalance ${portfolio}`,
    tradingUnavailable: (network: string) =>
      `Live stock trading is unavailable on ${network}. The pie is saved, and can be invested on mainnet.`,
    investLabel: "Invest $",
    moreThanCash: "More than your available cash.",
    howItSplits: "How it splits, toward your targets",
    waitingForPrices:
      "Waiting for live prices, so the split can account for what the pie already holds.",
    reviewOrders: "Review orders",
    rebalanceLead:
      "Rebalancing sells what sits above target, then invests what that returns into what sits below. Each half is priced and reviewed before anything is placed.",
    sellLeg: (name: string) => `Sell ${name}`,
    about: (dollars: string) => `about ${dollars}`,
    nothingToSell: "Nothing is far enough above target to sell.",
    priceSells: "Price the sells",
    pricing: "Getting live prices, one order at a time...",
    stepSell: "Step 1 of 2: sell what is above target.",
    stepBuy: "Step 2 of 2: invest what the sells returned.",
    quantityUnknown: "A token quantity cannot be shown right now. Try again in a moment.",
    feeUnverified: "A fee could not be verified. Go back and price the orders again.",
    keepAsCash: "Keep as cash",
    place: (count: number) => `Place ${plural(count, "order")}`,

    retired: (symbol: string) =>
      `${symbol} is no longer offered to buy. Edit the mix to remove it first.`,
    legFailed: (symbol: string, error: string) => `${symbol}: ${error}`,
    costCheckFailed: "Could not check the network cost of these orders. Try again.",
    tooLittle: (minimum: string) => `Too little to split. Each order needs at least ${minimum}.`,
    noOrderPlaced: (error: string) => `${error} No order was placed.`,
    balancesUnread: "Balances could not be read, so nothing was placed. Try again.",
    quantityNotShown: "This token's quantity cannot be shown right now. Nothing was placed.",
    stopped: "Nothing after the stopped order was placed. Check the balances before going on.",
    legFeeUnknown: "Stopped: the new price came without a fee that could be checked.",
    legNotAccepted: "Stopped: the new price was not accepted.",
    legNotPlaced: "The order could not be placed.",
    legUnread: "Placed, but the new balances could not be read yet. Stopped here.",
    proceedsUnread:
      "The sells went through, but the cash they returned could not be read. Invest it once the balance shows.",

    legBuy: (pay: string, expect: string, atLeast: string, fee: string) =>
      `Pay ${pay} · expect ${expect} · at least ${atLeast} · ${fee}`,
    legSell: (sell: string, expect: string, atLeast: string, fee: string) =>
      `Sell ${sell} · expect ${expect} · at least ${atLeast} · ${fee}`,
    feeUnknown: "fee unknown",
    fee: (percent: string) => `fee ${percent}%`,

    totalPay: "Total you pay",
    youReceive: "You expect to receive",
    usdc: (dollars: string) => `${dollars} USDC`,
    feesIncluded: "Fees, included above",
    feesFigure: (dollars: string, percent: string) => `about ${dollars} · ${percent}%`,
    ofWhichNoirWire: "Of which NoirWire",
    percent: (percent: string) => `${percent}%`,
    leftover: "Stays as cash, too small to split",
    smallOrders:
      "Small orders carry a larger fee share, because the fee also covers the network. Investing more at once lowers it.",
    oneAtATime:
      "Orders are placed one at a time. Each stops if it would deliver less than its minimum.",
    firmUntil: (time: string) =>
      ` Prices are firm until ${time}. One that expires before its turn is priced again, and you are asked first if the new price is worse.`,
    someUnchecked:
      "No live price was available to compare some of these quotes against. Check each order above before you confirm.",

    status: {
      waiting: "Waiting",
      placing: "Placing...",
      done: "Placed",
      failed: "Failed",
      "not placed": "Not placed",
    },
    openingAccounts: "Opening the accounts...",
    placing: (side: "buy" | "sell") => `Placing ${side === "buy" ? "buys" : "sells"}...`,
    nonePlaced: "No order was placed",
    allPlaced: (count: number) => `All ${count} orders placed`,
    somePlaced: (placed: number, total: number) => `${placed} of ${total} orders placed`,

    newPriceLabel: "New price",
    newPriceWorse: (name: string) => `The price for ${name} expired, and the new one is worse.`,
    reviewed: "Reviewed: ",
    now: "Now: ",
    paysOwnCost:
      "With this price the portfolio pays the order's network cost itself. If it cannot, the order is refused before signing.",
    stopHere: "Stop here",
    acceptPrice: "Accept new price",
  },
} as const;
