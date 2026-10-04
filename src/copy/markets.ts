import { plural } from "./plural.js";

/** Finding trackers, their prices and a tracker's own page. */
export const marketsCopy = {
  title: "Search",
  desktopTitle: "Markets",
  eyebrow: "Explore",
  lead: "Stock trackers. Prices shown are approximate. The final price is shown before you buy.",
  searchPlaceholder: "Company or ticker",
  searchLabel: "Search investments",
  tickerLabel: "Live market ticker",
  results: (count: number) => plural(count, "result"),
  noMatch: "No matching investment.",
  noMatches: "No matching investments.",
  pricesUnavailable: "Prices can't be shown right now. They are checked again every 30 seconds.",
  /** The quiet notice on Markets and a tracker's page when prices could not be read or have aged out. */
  stale: "We couldn't update prices. What you see may be out of date.",
  groups: {
    movers: "Top movers",
    index: "Funds and ETFs",
    companies: "Companies",
    watchlist: "My watchlist",
  },
  categories: {
    all: "All",
    companies: "Companies",
    index: "Funds and ETFs",
    watchlist: "My watchlist",
  },
  dayChange: "24h change",
  moversWaiting: "Top movers appear when current prices load.",
  moverLine: (symbol: string) => `${symbol} · 24h`,
  browseAll: "Browse all",
  categoriesLabel: "Market categories",
  nothingHere: "Nothing here yet.",
  atReview: "At review",
  noLivePrice: "No live price",
  approximatePrice: "Approximate price",
  issuerLine: (symbol: string, issuer: string | undefined) => `${symbol} · ${issuer ?? ""}`,
  assets: (count: number) => plural(count, "asset"),
  columns: {
    asset: "Asset",
    price: "Price",
    day: "24h",
    week: "1W history",
    trade: "Trade",
  },
  sorted: (descending: boolean) => (descending ? "↓" : "↑"),
  buy: "Buy",
  view: "View",
  showMore: (remaining: number) => `Show more (${remaining} left)`,
  watchToggle: (watched: boolean, symbol: string) =>
    `${watched ? "Remove" : "Add"} ${symbol} ${watched ? "from" : "to"} watchlist`,
  clearSearch: "Clear search",
  watchlistEmpty: "Your watchlist is empty.",
  rowLabel: (name: string, symbol: string, price: string | null, change: string | null) =>
    [name, symbol, price ?? "no live price", change].filter(Boolean).join(", "),
  changeSpoken: (percent: number) =>
    Math.abs(percent) < 0.005
      ? "unchanged today"
      : `${percent > 0 ? "up" : "down"} ${Math.abs(percent).toFixed(2)} percent today`,

  chooser: {
    results: (label: string) => `${label} results`,
    option: (action: string, name: string) => `${action} ${name}`,
    more: (hidden: number) => `${hidden} more. Type a name or ticker to narrow it down.`,
  },

  chart: {
    loading: "Loading history",
  },

  detail: {
    notFound: "No such investment.",
    backToSearch: "Back to search",
    search: "Search",
    watch: (watched: boolean) => (watched ? "Remove from watchlist" : "Add to watchlist"),
    priceUnavailable: "Current price unavailable",
    past24h: "past 24h",
    finalPrice: "The final price is shown before you buy.",
    historyLabel: "Price history",
    loadingHistory: "Loading price history...",
    noChart: "Chart unavailable right now.",
    historySource: "Historical prices",
    yourHolding: "Your holding",
    holdingValue: (value: string) => `${value} approximate value`,
    valueWaiting: "Value available when a current price loads",
    notOwned: "You do not own this tracker yet.",
    about: "About",
    aboutTracker: (symbol: string, name: string) =>
      `${symbol} is an xStocks tracker certificate that follows ${name}. It is not a direct company or ETF share and gives no voting rights.`,
    /** The line under a tracker's name: "NVIDIA tracker · NVDAx". */
    trackerLine: (name: string, symbol: string) => `${name} tracker · ${symbol}`,
    follows: (name: string) => `Follows ${name}'s share price. You do not own a share.`,
    /** `dollars` is about the smallest order that is placed, already formatted. */
    smallestOrder: (dollars: string) => `The smallest order is about ${dollars}.`,
    publicTrades: "Trades, amounts and timing are visible on chain.",
    /** Under "Read the risks". */
    issuerPowers: "The company that issues this tracker can freeze or remove it.",
    dividends:
      "Dividends are not paid out. The issuer reinvests them, so the balance shown here grows instead. Stock splits change the balance the same way.",
    high: "High",
    low: "Low",
    retired: (symbol: string) =>
      `${symbol} is no longer offered to buy here. What you hold can still be sold or sent.`,
    retiredShort: (symbol: string) => `${symbol} is no longer offered to buy here.`,
    retiredMobile: "No longer offered to buy.",
    issuerDetails: "Read issuer details",
    tradePanel: "Trade panel",
    tradeDirection: "Trade direction",
    startInvesting: "Start investing",
    createWalletFirst: "Create a wallet before placing an order.",
    createPortfolioFirst: "Create a portfolio before placing an order.",
    createWallet: "Create a wallet to invest",
    createPortfolio: "Create portfolio",
    buy: "Buy",
    sell: "Sell",
    tradeTitle: (side: "buy" | "sell", name: string) =>
      `${side === "buy" ? "Buy" : "Sell"} ${name} tracker`,
    approximate: "Approximate price",
    rangeLabel: "Chart range",
    rangeName: { "1D": "1 day", "1W": "1 week", "1M": "1 month" },
    chartLabel: (range: string, from: string, to: string, change: string) =>
      `${range} price chart. Started at ${from}, now ${to}, ${change}.`,
    backToMarkets: "Back to Markets",
    aboutAndRisk: "About and risk",
    readRisks: "Read the risks",
    holdingRow: (label: string, quantity: string) => `${label} · ${quantity}`,
    /** One line under the chart: how to read its price and date at a point. */
    chartHint: "Hover to see the price and date.",
  },
} as const;

/** What the phone says differently about markets and a tracker's page. Everything else is `marketsCopy`. */
export const mobileMarketsCopy = {
  searchLabel: "Search trackers",
  showMore: (remaining: number, page: number) =>
    remaining > page ? `Show ${page} more` : `Show ${remaining} more`,
  watchlistEmptyDetail: "Tap the star on a tracker to save it here.",
  detail: {
    createPortfolio: "Create a portfolio",
    offline: "You're offline. Nothing can be bought or sold until you're back online.",
    chartHint: "Press and hold to see the price and date.",
  },
} as const;
