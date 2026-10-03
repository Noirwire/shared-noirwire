/** What frames every screen: navigation, the network banner and gate, and the status pages. */
export const appCopy = {
  name: "NoirWire",
  description: "Purpose-based private portfolios for crypto and tokenized stocks.",
  installDescription: "Invest in tokenized US stocks from a wallet only you hold.",

  nav: {
    home: "Home",
    search: "Search",
    markets: "Markets",
    earn: "Earn",
    activity: "Activity",
    more: "More",
    homeLabel: "NoirWire home",
    tagline: "Private portfolios",
    primary: "Primary navigation",
    createWallet: "Create wallet",
    openPortfolio: "Open portfolio",
    portfolios: "Portfolios",
    moreSettings: "More settings",
    lock: "Lock wallet",
    weakPassword: "Your password is easy to guess. Change it to protect this wallet.",
  },

  networkBanner: "Test network · never send mainnet funds",

  networkGate: {
    wrongNetwork: (network: string) =>
      `NoirWire is not connected to ${network} as it should be. Your money has not moved, and nothing can be sent until this is fixed. Try again later.`,
    unreachable: "We can't show your balances right now. Your money has not moved. Try again.",
    retry: "Try again",
  },

  dialogClose: "Close",

  status: {
    errorTitle: "This screen hit a problem.",
    errorBody:
      "Nothing is sent without your review, so a display error does not move money. If you were placing an order, check Activity before trying it again.",
    retry: "Try again",
    home: "Back to home",
    notFoundTitle: "Nothing at this address.",
    notFoundBody:
      "The page may have moved, or the link may be mistyped. Your wallet and everything in it are untouched.",
    ravenSecret: "The raven saw nothing.",
    nudgeRaven: "Nudge the raven",
  },
} as const;

/** The phone's network gate and offline banner. */
export const mobileAppCopy = {
  network: {
    checking: "Getting things ready...",
    offline:
      "You're offline. Balances and prices may be out of date, and nothing can be sent until you're back online.",
  },
} as const;
