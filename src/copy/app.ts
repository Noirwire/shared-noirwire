/** What frames every screen: navigation, the network banner and gate, and the status pages. */
export const appCopy = {
  name: "NoirWire",
  description: "Private portfolios for US stock trackers.",
  installDescription: "Invest in US stock trackers from a wallet only you hold.",

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

  /**
   * That the product itself is still being tested. About NoirWire, not about
   * a network, so it is said on the main network as on any other.
   */
  beta: {
    /** A small label beside the NoirWire mark, in the header and on Welcome. */
    tag: "Beta",
    /** The line in Settings, on its About page. */
    line: "NoirWire is in testing. Start with small amounts.",
  },

  networkBanner: "Test network · never send main network funds",

  networkGate: {
    wrongNetwork: (network: string) =>
      `NoirWire is not connected to ${network} as it should be. Your money has not moved, and nothing can be sent until this is fixed. Try again later.`,
    unreachable: "We can't show your balances right now. Your money has not moved. Try again.",
    /** Said to someone with no wallet yet, or with one still locked: there are no balances to speak of. */
    cannotReach: "Can't reach NoirWire. Check your connection and try again.",
    retry: "Try again",
  },

  /** The app with no connection: a page that cannot be opened, and a wallet that is ready for when it can. */
  offline: {
    blocked: "That page can't be opened while you're offline. You are still on this one.",
    walletReady: "Your wallet is saved and unlocked. It opens as soon as you're back online.",
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

  /** The phone checks its security features on every start; a failure stops the app before it opens anything. */
  runtimeFailure: {
    title: "NoirWire cannot run safely on this device",
    detail:
      "The app checks its security features every time it starts. These did not work as expected, so nothing was opened and no keys were read:",
    /** What a failed setup check (not a security check) is listed as. */
    configFailure: "App configuration",
    closing:
      "Update the app and try again. Your wallet is not affected: it can always be restored with its recovery phrase.",
  },
} as const;
