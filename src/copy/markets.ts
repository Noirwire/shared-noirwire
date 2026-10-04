import { plural } from "./plural.js";

/** Finding trackers, their prices and a tracker's own page. */
export const marketsCopy = {
  title: "Search",
  desktopTitle: "Markets",
  eyebrow: "Explore",
  lead: "Tokenized stock trackers. Live display prices are indicative; the trade price appears at review.",
  searchPlaceholder: "Company or ticker",
  searchLabel: "Search investments",
  tickerLabel: "Live market ticker",
  results: (count: number) => plural(count, "result"),
  noMatch: "No matching investment.",
  noMatches: "No matching investments.",
  pricesUnavailable: "Prices can't be shown right now. They are checked again every 30 seconds.",
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
  liveIndicative: "Live indicative",
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
    liveNote: "Live indicative price. Your order quote is confirmed at review.",
    quoteNote: "Your order price comes from a live quote at review.",
    historyLabel: "Price history",
    loadingHistory: "Loading price history...",
    noChart: (range: string) => `No verified ${range} chart available.`,
    historySource: "Historical prices · Jupiter",
    yourHolding: "Your holding",
    holdingValue: (value: string) => `${value} indicative value`,
    valueWaiting: "Value available when a current price loads",
    notOwned: "You do not own this tracker yet.",
    about: "About",
    aboutTracker: (symbol: string, name: string) =>
      `${symbol} is an xStocks tracker certificate that follows ${name}. It is not a direct company or ETF share and gives no voting rights.`,
    issuerControl:
      "The issuer can freeze, move or burn these tokens without your signature. Trades, amounts and timing are visible on chain.",
    dividends:
      "Dividends are not paid out in cash. The issuer reinvests them by raising a multiplier on the token, so the balance shown here grows instead. Stock splits change the balance the same way.",
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
    indicative: "Indicative",
    rangeLabel: "Chart range",
    rangeName: { "1D": "1 day", "1W": "1 week", "1M": "1 month" },
    chartLabel: (range: string, from: string, to: string, change: string) =>
      `${range} price chart. Started at ${from}, now ${to}, ${change}.`,
    backToMarkets: "Back to Markets",
    aboutAndRisk: "About and risk",
    readRisks: "Read the risks",
    holdingRow: (label: string, quantity: string) => `${label} · ${quantity}`,
  },
} as const;

/** What the phone says differently about markets and a tracker's page. Everything else is `marketsCopy`. */
export const mobileMarketsCopy = {
  searchLabel: "Search trackers",
  showMore: (remaining: number, page: number) =>
    remaining > page ? `Show ${page} more` : `Show ${remaining} more`,
  watchlistEmptyDetail: "Tap the star on a tracker to save it here.",
  detail: {
    liveNote: "Your order price is confirmed at review.",
    dividends:
      "Dividends are not paid out in cash. The issuer reinvests them by raising a multiplier on the token, so the balance shown here grows instead. Splits change the balance the same way.",
    createPortfolio: "Create a portfolio",
    offline: "You're offline. Nothing can be bought or sold until you're back online.",
  },
} as const;
