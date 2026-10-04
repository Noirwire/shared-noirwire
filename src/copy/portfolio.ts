import type { PortfolioIconGlyph, PortfolioIconTint } from "../domain/portfolioIcon.js";
import { privateMoveTiming } from "./funding.js";
import { plural } from "./plural.js";

const noDayChange = "No live day change available";

/** Names never leave where the wallet is kept: "this browser" or "this phone". */
const nameStays = (place: string) => `Give it a name only you see. The name never leaves ${place}.`;

/** What is not written on chain, and where it stays: "in this browser" or "on this phone". */
const staysLocal = (place: string) =>
  `These stay ${place}. Balance reads and trades go through NoirWire's own server, so the network provider, Jupiter and MagicBlock see this address but never your IP address. The server keeps only a basic record that a request was made, not your address or what's in it, but you have to trust it keeps nothing more.`;

/** Home's combined total is added up only where the wallet is kept. */
const addedUpHere = (place: string) =>
  `This total is added up ${place}. Nothing on chain ties your portfolios to each other or to your funding wallet, and NoirWire's server never receives the sum.`;

/** A portfolio's public view, as far as the place the wallet is kept knows. */
const publicViewWords = (place: string) => ({
  announce: `Public view. Showing what someone with this address can see, as far as ${place} knows.`,
  transactions: `Transactions ${place} knows about`,
  notFullHistory: `This is not the full history. Every transfer and trade on this address is public on chain, with its amount and time, including any made before ${place} or outside this app.`,
  noTransactions: `${place.charAt(0).toUpperCase()}${place.slice(1)} has recorded nothing for this address.`,
});

/** A portfolio could not be stored where the wallet is kept. */
const notSavedIn = (place: string) => `The new portfolio could not be saved ${place}.`;
const createToStart = "Create a portfolio to start investing.";
const activityEmpty = "Money moves and trades appear here.";
const refreshFailed =
  "We couldn't update your balances. What you see may be out of date. Pull down to try again.";

/** Home, a portfolio's own screen, and creating, naming and funding portfolios. */
export const portfolioCopy = {
  home: {
    title: "Home",
    eyebrow: "Overview",
    addMoney: "Add money",
    summaryLabel: "Wallet summary",
    totalValue: "Total value",
    dayApproximate: "24h approximate",
    heldDayApproximate: "held assets · 24h approximate",
    noDayChange,
    invested: "Invested",
    heldTrackers: "Held trackers",
    readyToInvest: "Ready to invest",
    acrossPortfolios: "Across portfolios",
    earning: "Earning",
    apy: (rate: string) => `${rate}% variable APY`,
    apyUnavailable: "Current APY unavailable",
    viewApy: "View current APY in Earn",
    notAvailable: "N/A",
    waitingForValues: "Waiting for current balances or market prices",
    excludesEarn: "Excludes money in Earn, which could not be read yet",
    valueUnavailable: "Value unavailable",
    yourInvestments: "Your investments",
    assets: (count: number) => plural(count, "asset"),
    columns: {
      asset: "Asset",
      units: "Units",
      price: "Price",
      day: "24h",
      value: "Value",
      allocation: "Alloc.",
      week: "1W",
      portfolio: "Portfolio",
      investments: "Investments",
      cash: "Cash",
    },
    atReview: "At review",
    share: (percent: string) => `${percent}%`,
    noInvestments: "No investments yet. ",
    exploreMarkets: "Explore markets",
    portfolios: "Portfolios",
    newPortfolio: "New portfolio",
    new: "New",
    pie: "Pie",
    createToStart,
    watchlist: "Watchlist",
    viewMarkets: "View markets",
    watchlistEmpty: "Save trackers to find them here.",
    recentActivity: "Recent activity",
    seeAll: "See all",
    activityEmpty,
    marketLists: "Market lists",
    shelves: {
      watchlist: "My watchlist",
      companies: "Companies",
      index: "Index trackers",
    },
    earn: "Earn",
    watchlistEmptyMobile: "Your watchlist is empty.",
    findInvestments: "Find investments",
    archivedPortfolios: "Archived portfolios",
    restore: (label: string) => `Restore ${label}`,
    heldTrackersDay: (delta: string) => `${delta} held trackers · 24h approximate`,
    onlyYouSee: "Only you see this total",
    togetherExplained: addedUpHere("in this browser"),
    findTrackers: "Find trackers",
    /** Under Home's one button while the wallet is empty. */
    moneyArrives: "Your money arrives in your funding wallet. Then you move it into a portfolio.",
    lookAtTrackers: "Look at trackers first",
    portfolioLine: {
      holdings: (ready: string, count: number) =>
        `${ready} to invest · ${plural(count, "holding")}`,
      pie: (count: number, ready: string) =>
        `Pie · ${plural(count, "tracker")} · ${ready} to invest`,
    },
    archivedCount: (count: number) => `Archived portfolios (${count})`,
    restored: "Restored.",
    noInvestmentsYet: "No investments yet. Find a company or index tracker to get started.",
  },

  earnPromo: {
    eyebrow: "Earn · Jupiter Lend",
    rate: (rate: string) => `${rate}%`,
    apy: "APY",
    couldBeEarning: "Your USDC could be earning",
    couldEarn: (ready: string, yearly: string) =>
      `Your ${ready} could earn about ${yearly} a year.`,
    waitingMoney: "Money that is waiting to be invested can earn in the meantime.",
    start: "Start earning",
    footnote: "Variable rate, shown as of now. Lending carries risk.",
  },

  holdings: {
    noInvestments: "No investments yet",
    findTracker: "Find a company or index tracker to get started.",
    search: "Search investments",
    tokens: (amount: string) => `${amount} tokens`,
    line: (symbol: string, amount: string) => `${symbol} · ${amount}`,
    liveValue: "Live value",
    balanceConfirmed: "Balance confirmed",
    title: "Holdings",
    titleInPie: "Cash and other holdings",
    empty: "Nothing here yet. Move money into this portfolio to get started.",
    sell: "Sell",
  },

  card: {
    pie: (trackers: number) => `Pie · ${plural(trackers, "tracker")}`,
    investments: (count: number) => plural(count, "investment"),
    noInvestments: "No investments yet",
    valueUnavailable: "Value unavailable",
  },

  detail: {
    allPortfolios: "All portfolios",
    pie: "Pie",
    portfolio: "Portfolio",
    created: (date: string) => `Created ${date}`,
    value: "Portfolio value",
    valueUnavailable: "Value unavailable",
    readyToInvest: (amount: string) => `${amount} USDC ready to invest`,
    moveToPortfolio: "Move to portfolio",
    invest: "Invest",
    buy: "Buy an investment",
    rebalance: "Rebalance",
    receive: "Receive",
    send: "Send",
    settings: "Portfolio settings",
    archivedTitle: "This portfolio is archived.",
    archivedLead:
      "It stays visible and its history is kept, but it is hidden from the portfolio list.",
    recentActivity: "Recent activity",
    nothingMoved: "Nothing has moved yet. Move money into this portfolio to begin.",
    advancedAddress: "Advanced portfolio address",
    copyAddress: "Copy address",
    kindLine: (kind: string, date: string) => `${kind} · Created ${date}`,
    buyTracker: "Buy a tracker",
    sendDisabled: "Nothing to send yet.",
    seePublicView: "See public view",
    emptyTitle: "Nothing here yet.",
    addFirstTracker: "Add your first tracker",
    moveMoneyFirst: "Move money in first, then choose a tracker.",
    backHome: "Back to Home",
    restore: "Restore",
    cashName: "Cash",
    sellLabel: (name: string) => `Sell ${name}`,
  },

  mix: {
    targetLine: (weight: number) => `Target ${weight}%`,
    nowShare: (actual: string, drift: "over" | "under" | null) =>
      drift ? `Now ${actual}% · ${drift}` : `Now ${actual}%`,
    ringLabel: (slices: readonly string[]) => slices.join(". "),
    sliceSpoken: (name: string, weight: number, actual: string | null, drift: string | null) =>
      [
        `${name}, target ${weight} percent`,
        actual === null ? null : `now ${actual} percent`,
        drift ? `${drift} target` : null,
      ]
        .filter(Boolean)
        .join(", "),
  },

  publicView: {
    eyebrow: "Public view",
    lead: "Someone with this address can see these. Your other portfolios are not shown by this address.",
    ...publicViewWords("this browser"),
    address: "Address",
    hidden: "Hidden",
    show: "Show",
    hide: "Hide",
    copy: "Copy",
    copied: "Copied",
    showAddress: "Show this portfolio's address",
    hideAddress: "Hide the address",
    copyAddress: "Copy this portfolio's address",
    holdings: "Holdings",
    noHoldings: "Nothing is held at this address as last read.",
    back: "Back to my view",
  },

  /** The state of the balances on screen, beside them. */
  balances: {
    updating: "Updating balances...",
    stale: "We couldn't update your balances. What you see may be out of date.",
  },

  /** What archived portfolios still hold, and archiving one that holds something. */
  archived: {
    value: (value: string) => `Plus ${value} in archived portfolios, not counted above.`,
    valueUnpriced: "Archived portfolios still hold investments, not counted above.",
    earnNotIncluded:
      "What archived portfolios have in Earn can't be read right now and is not included.",
    earnUnknown: "What it has in Earn can't be shown right now, and is hidden with it.",
    earnUnknownAlone:
      "What this portfolio has in Earn can't be shown right now. Archiving hides it; it does not move anything.",
    heldIn: (portfolio: string) => `${portfolio} (archived)`,
    confirm: "Archive anyway",
    keep: "Keep it",
  },

  settings: {
    title: "Portfolio settings",
    nameLabel: "Portfolio name",
    restoreTitle: "Restore this portfolio",
    archiveTitle: "Archive this portfolio",
    archiveLead:
      "It disappears from the portfolio list. Nothing is deleted and you can restore it at any time.",
    stillHolds: (value: string) =>
      `This portfolio still holds ${value}. Archiving hides it; it does not move anything.`,
    stillHoldsUnpriced:
      "This portfolio still holds investments. Archiving hides it; it does not move anything.",
  },

  create: {
    titlePortfolio: "New portfolio",
    titlePie: "New pie",
    kindsLabel: "What to create",
    kinds: {
      portfolio: { title: "Portfolio", description: "Buy one investment at a time." },
      pie: {
        title: "Pie",
        description: "Set a mix of trackers and invest in all of them at once.",
      },
    },
    lead: nameStays("this browser"),
    nameLabel: "Portfolio name",
    namePlaceholder: "Investing",
    suggestions: ["Investing", "Long term", "Everyday"],
    creating: "Creating portfolio...",
    submit: "Create portfolio",
    pieLead:
      "A pie is its own portfolio with its own address. Investing splits your money across the mix.",
    pieSubmit: "Create pie",
    pieCreating: "Creating pie...",
    notSaved: notSavedIn("in this browser"),
  },

  icon: {
    label: "Icon and color",
    change: "Change",
    icon: "Icon",
    color: "Color",
    usePieRing: "Use the pie ring",
    glyphOption: (name: string) => `${name} icon`,
    tintOption: (name: string) => `${name} color`,
    glyphs: {
      compass: "General",
      target: "Goal",
      flag: "Milestone",
      mountains: "Ambition",
      house: "Home",
      graduation: "Education",
      airplane: "Travel",
      heart: "Personal",
      shield: "Steady",
      clock: "Long term",
      globe: "Global",
      tree: "Nature",
      sun: "Energy",
      lightning: "Growth",
      "chart-line": "Markets",
      "chart-pie": "Diversified",
      buildings: "Property",
      factory: "Industry",
      heartbeat: "Healthcare",
      flask: "Research",
      cpu: "Chips",
      robot: "Automation",
      cloud: "Software",
      wifi: "Connectivity",
      car: "Mobility",
      truck: "Logistics",
      shopping: "Consumer",
      coins: "Income",
      briefcase: "Business",
      scales: "Balance",
      bank: "Finance",
      diamond: "Quality",
    } satisfies Record<PortfolioIconGlyph, string>,
    tints: {
      neutral: "Neutral",
      sage: "Sage",
      blue: "Blue",
      lilac: "Lilac",
      clay: "Clay",
      ochre: "Ochre",
      teal: "Teal",
      rose: "Rose",
    } satisfies Record<PortfolioIconTint, string>,
  },

  observer: {
    eyebrow: "Privacy posture",
    noLabel: "No owner label onchain",
    standalone:
      "This portfolio appears as a standalone address, without your name or its NoirWire label.",
    publicTitle: "Public onchain",
    copyAddress: "Copy portfolio address",
    publicNote: "Balances and activity on this address are public.",
    visible: "Balances, asset tickers, transfers, trades, amounts, and timing are visible.",
    privateTitle: "Not written onchain",
    privateItems: [
      "Your local portfolio name",
      "Its relationship to your funding wallet",
      "Which other NoirWire portfolios you control",
    ],
    relayed: staysLocal("in this browser"),
    relayer:
      "When NoirWire's relayer pays a network cost for this portfolio, that transaction names the relayer, so an observer can tell this address uses NoirWire. It does not name your funding wallet or your other portfolios.",
    clue: "Funding can still create a clue. Reusing a known address or moving a distinctive amount moments later may let an observer infer a connection.",
  },

  receive: {
    title: "Receive",
    lead: (portfolio: string, network: string) =>
      `${portfolio}'s own address on ${network}, derived from your recovery phrase.`,
    mainnet: " Only send Solana assets to it. Funds sent from another network are lost.",
    testNetwork: " It holds devnet assets only, so never send mainnet funds to it.",
    copyAddress: "Copy address",
    copyDescribe: "Copy portfolio address",
    publicNote:
      "A transfer straight to this address is public and ties the sender to this portfolio. To move in your own money, use Move to portfolio instead.",
    fundingTitle: "Your funding wallet address",
    fundingNotice: "This first transfer is public and may link the sending address to you.",
    portfolioTitle: (name: string) => `Receive in ${name}`,
    hiddenFunding: "Your funding wallet address is hidden.",
    showAddress: "Show address",
    copied: "Copied",
    qrFunding: "QR code of your funding wallet address",
    qrPortfolio: (name: string) => `QR code of ${name}'s address`,
    afterArrival: "Once it arrives, choose a portfolio and tap Move to portfolio.",
    archived: "This portfolio is archived. Restore it before receiving into it.",
  },

  /** Bringing money in from outside: the explainer, its three steps and the funding wallet's address. */
  addMoney: {
    title: "Add digital dollars",
    arrived: (amount: string) =>
      `${amount} USDC has arrived in your funding wallet. Move it to a portfolio before buying.`,
    moveTo: (portfolio: string) => `Move to ${portfolio}`,
    steps: {
      get: {
        title: "Get USDC",
        detail: (network: string) =>
          `USDC is a digital dollar: 1 USDC = $1. NoirWire cannot take card payments yet. Buy USDC in any app or service that can send it on the ${network} network. No account with us is needed.`,
      },
      send: {
        title: "Send it to your funding wallet",
        detail: (network: string) =>
          `Copy the address below. In the other app choose USDC and the ${network} network, and check the address before sending. This transfer is public.`,
      },
      move: {
        title: "Move it into a portfolio",
        /** `cost` is what a private move costs, from the fee constants: "0.1% + $0.20". */
        detail: (cost: string) =>
          `When it arrives, choose a portfolio and tap Move to portfolio. A private move is not linked to your funding wallet in the public record. It costs ${cost}. ${privateMoveTiming}`,
      },
    },
    network: (network: string) => `Network: ${network}`,
    onlyUsdc: (network: string) =>
      `Only send USDC on ${network}. Other assets or networks may be lost.`,
    copyAddress: "Copy address",
    copyDescribe: "Copy funding wallet address",
    costsLink: "What does it cost?",
  },

  notFound: {
    message: "That portfolio does not exist.",
    back: "Back to portfolios",
  },
} as const;

/**
 * What the phone says differently on Home, a portfolio's screens and
 * receiving. Everything else is `portfolioCopy`.
 */
export const mobilePortfolioCopy = {
  home: {
    togetherExplained: addedUpHere("on this phone"),
    refreshFailed,
  },
  detail: {
    offline: "You're offline. Nothing can be sent until you're back online.",
    moreLabel: "Portfolio settings",
    refreshFailed,
  },
  publicView: {
    ...publicViewWords("this phone"),
    notOnChainTitle: "Not written on chain",
    notOnChain: [
      "Your portfolio name",
      "Its relationship to your funding wallet",
      "Which other NoirWire portfolios you control",
    ],
    relayed: staysLocal("on this phone"),
    markAction: "See public view",
  },
  create: {
    /** A name field's placeholder, worded so it cannot be mistaken for a name already typed. */
    forExample: (name: string) => `For example: ${name}`,
    /** Pressing Create with no name typed. */
    nameNeeded: "Type a name first.",
    lead: nameStays("this phone"),
    notSaved: notSavedIn("on this phone"),
    kinds: {
      portfolio: { title: "Portfolio", description: "Buy one tracker at a time." },
    },
  },
  icon: {
    pieRingMark: "The pie's ring, its default mark",
    label: "Icon and colour",
    done: "Done",
    glyphGroup: "Icon",
    tintGroup: "Colour",
    tintOption: (name: string) => `${name} colour`,
  },
} as const;
