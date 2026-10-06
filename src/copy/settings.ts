import { walletCopy } from "./wallet.js";

/** `where` is where the wallet is kept, `lost` is when unsaved changes go: "after a reload" or "when the app closes". */
const saveFailing = (where: string, lost: string) =>
  `Changes are not being saved ${where} (storage is full or blocked). What you see here will be gone ${lost}. Your funds are not affected.`;

/** `where` is "in this browser" or "on this phone". */
const passwordChanged = (where: string) =>
  `Password changed. Use the new one next time you unlock. This protects the copy ${where} only: if you think someone already copied this wallet, move your funds to a new recovery phrase.`;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The settings screen. */
export const settingsCopy = {
  eyebrow: "More",
  title: "Settings",
  lead: "Manage your wallet, security and privacy in one place.",
  saveFailing: saveFailing("in this browser", "after a reload"),

  sections: {
    security: {
      title: "Security and recovery",
      help: "Keep access to your wallet and protect its recovery phrase.",
    },
    wallet: { title: "Wallet details", help: "Check what is held in your main wallet." },
    privacy: {
      title: "Privacy",
      help: "Understand what is public and control usage analytics.",
      /** Said where the screen has no analytics control to offer. */
      helpWithoutAnalytics: "Understand what is public.",
    },
    risks: { title: "Risks", help: "What to know before you put money in." },
    explore: { title: "Explore", help: "Other places in NoirWire.", label: "More sections" },
    danger: {
      title: "Danger zone",
      help: "Actions here can remove access to this wallet on this device.",
      label: "Danger zone",
    },
  },

  explore: {
    portfolios: "Your portfolios",
    activity: "Activity",
    security: "Security and recovery",
    privacy: "About privacy",
    risks: "Risks",
  },

  recovery: {
    title: "Recovery phrase",
    description: "Your way back in if you forget your password",
    value: "View safely",
    lead: "The phrase every portfolio in this wallet comes from. It is the only way back in if you forget your password.",
    copyDescribe: "Copy recovery phrase",
    hide: "Hide phrase",
    hidesItself: "It hides again by itself after a minute.",
    passwordLabel: "Enter your password to show it",
    show: "Show",
    wrongPassword: walletCopy.store.wrongPassword,
    footnote:
      "Stored encrypted under your password. Anyone who has these words controls every portfolio that comes from them, on any device. NoirWire will never ask you for them.",
  },

  password: {
    title: "Password",
    descriptionWeak: "Your password needs attention",
    description: "Change your wallet password",
    valueWeak: "Action needed",
    value: "Change",
    weak: "Your password is easy to guess. Anyone who copies this browser's data could try it offline. Change it below.",
    current: "Current password",
    failed: walletCopy.store.passwordNotChanged,
    changed: passwordChanged("in this browser"),
    reEncrypting: "Saving...",
    submit: "Change password",
  },

  funding: {
    title: "Main wallet",
    description: "Balance and address for adding funds",
    lead: "Your money arrives here. Move it to a portfolio to invest.",
    assets: "USDC and network fees",
    advanced: "Advanced: main wallet address",
    copyDescribe: "Copy main wallet address",
  },

  /** What things cost, as a row in Settings and wherever "What does it cost?" leads. */
  costs: {
    title: "Costs",
    description: "What buying, moving and sending cost",
    /** `percent` is the trading fee, from the app's own setting: "0.5". */
    trade: (percent: string) => `Buying or selling a tracker: ${percent}% of the trade.`,
    /** Said where the app charges no trading fee of its own. */
    tradeNoFee: "Buying or selling a tracker: no NoirWire fee.",
    /** `cost` is what a private move costs, from the fee constants: "0.1% + $0.20". */
    move: (cost: string) => `Moving money into a portfolio privately: ${cost}.`,
    network: "Network cost: a few cents, paid automatically from your USDC.",
    gettingUsdc: "Getting USDC from another service: that service may charge its own fee.",
    exact: "The exact amount is always shown before you confirm.",
  },

  protection: {
    title: "Privacy and your funds",
    description: "What others can see",
    value: "Read details",
    onChain: (assets: string, network: string) =>
      `Every portfolio, its ${assets} balances and every stock trade are real transactions on ${network}. Portfolio labels stay in this browser only.`,
    tradesPublic:
      "Trades are public on chain. Private funding makes them harder to link back to your known wallet. It does not make them invisible: amounts and timing may still be inferable.",
    relay:
      "Your keys and recovery phrase never leave this browser. Network requests go through NoirWire's own server, so the network provider, Jupiter and MagicBlock never see your IP address. The server keeps only a basic record that a request happened and whether it worked, a short-lived count to stop overuse, and an anonymous pass that isn't tied to your name or wallet and changes every day. You have to trust it keeps nothing more. Those providers still see the addresses themselves, and requests made moments apart can let them guess that two addresses belong together.",
    relayer:
      "Actions paid through NoirWire's relayer show the same relayer address and payment account for every NoirWire portfolio. An observer can tell that a portfolio uses NoirWire and can group NoirWire portfolios as a set. That does not link them to a person, to your main wallet or to each other directly.",
    phraseMainnet:
      "Anyone with your recovery phrase can take everything in every portfolio. Never share it, never type it into another site, and never reuse it for another wallet.",
    phraseTestNetwork: (network: string, tokens: string) =>
      `These addresses hold ${network} SOL and test tokens (${tokens}). Do not send main network funds here, and never reuse this recovery phrase for another wallet.`,
  },

  analytics: {
    title: "Usage analytics",
    description: "Choose whether to share anonymous usage counts",
    on: "On",
    off: "Off",
    what: "We count which screens are opened and which actions are taken, on our own server, to see what works, along with a rough state of the wallet such as how old it is and whether it holds investments. Your IP address is removed before a count is stored, and a count never carries an address, a portfolio name, an amount or anything you type.",
    late: 'Trades, funding and sends are counted in total only, late, and without anything saying whose they were. A browser set to "Do Not Track" is never counted.',
    turnOff: "Analytics on. Turn off",
    turnOn: "Analytics off. Turn on",
  },

  risks: {
    title: "Risks",
    description: "What can go wrong",
    value: "Read details",
    paragraphs: [
      "A tracker is a certificate that follows the price of a stock or fund. It is not a share: it carries no voting rights and no claim on the company.",
      "The issuer of a tracker keeps control over its own tokens. It can freeze them, and move or burn them without your signature.",
      "Balances, trades, transfers, amounts and timing are public on chain for every portfolio address. Private funding makes a portfolio harder to link to you. It does not hide what the portfolio does.",
      "USDC in Earn is lent out through Jupiter Lend. The rate changes, withdrawals can be delayed while the pool is heavily borrowed, and a failure of the lending program can cause loss. It is not a bank deposit and is not insured.",
      "This software has not been audited.",
      "Only your recovery phrase restores this wallet. Nobody else holds a copy, and nobody can reset it for you.",
    ],
  },

  reset: {
    title: "Reset wallet",
    lead: "Deletes the wallet and everything in it from this browser. There is no undo and no backup: only your recovery phrase can bring it back.",
    button: "Reset wallet",
  },
} as const;

/**
 * What the phone's settings say that the web's do not, or say differently:
 * unlocking with a fingerprint or a face, its own privacy and risk pages, and
 * "this phone" where the web says "this browser". Everything else is
 * `settingsCopy`. `method` is the device's own name for its biometric check.
 */
export const mobileSettingsCopy = {
  saveFailing: saveFailing("on this phone", "when the app closes"),
  cleanupFailing:
    "An old copy of a recovery phrase from an earlier version could not be deleted from this phone, so it may still be readable there. Reset the wallet and restore it again if this stays.",
  saving: "Saving...",

  biometric: {
    label: (method: string) => `Unlock with ${method}`,
    caption:
      "Your password is still needed to view your recovery phrase and to change the password.",
    changed: (method: string) =>
      `${sentence(method)} settings changed on this phone, so this was turned off. Turn it on again to keep using it.`,
    passwordLabel: "Enter your password to turn it on",
    turnOn: "Turn on",
    wrongPassword: walletCopy.store.wrongPassword,
    failed: (method: string) => `${sentence(method)} was not turned on. Try again.`,
  },
  lockNow: "Lock now",
  analyticsCaption:
    "Counts which screens and actions are used. Never an address, a name, an amount, a tracker or anything you type.",
  aboutSection: "About",
  aboutRow: "About NoirWire",
  risksCaption: "What you should know before you invest",
  resetCaption: "Deletes the wallet from this phone",

  password: {
    changed: passwordChanged("on this phone"),
  },

  phrase: {
    hiddenAnnouncement: "Recovery phrase hidden",
  },

  privacy: {
    title: "Privacy and your funds",
    sections: [
      {
        title: "What is public",
        body: "Every portfolio, its balances and every trade are real transactions on Solana. Trades stay public: anyone can see a portfolio's holdings, amounts and timing. Portfolio names stay on this phone only.",
      },
      {
        title: "What private funding does",
        body: "Private funding makes a portfolio harder to link back to your main wallet. It does not make it invisible: amounts and timing may still let someone infer a connection.",
      },
      {
        title: "What stays on this phone",
        body: "Your keys and recovery phrase never leave this phone. So do your portfolio names, your watchlist and your activity list.",
      },
    ],
    partiesTitle: "Who can see what",
    parties: [
      {
        name: "NoirWire's server",
        lines: [
          "Sees your IP address and, in transit, every address the app asks about.",
          "Keeps only a basic record that a request happened and whether it worked, a short-lived count to stop overuse, and an anonymous pass that isn't tied to your name or wallet and changes every day. You have to trust it keeps nothing more.",
          "It could link your main wallet to a portfolio if it kept more than that. It does not.",
        ],
      },
      {
        name: "The network provider",
        lines: [
          "Does not see your IP address.",
          "Sees every address read and every transaction sent.",
          "Requests made moments apart can let it guess that two addresses belong together.",
        ],
      },
      {
        name: "Jupiter",
        lines: [
          "Does not see your IP address.",
          "Sees the portfolio that trades or lends. Never your main wallet.",
        ],
      },
      {
        name: "MagicBlock, the private funding service",
        lines: [
          "Does not see your IP address.",
          "Sees your main wallet and the portfolio together. A private transfer cannot be built without naming both.",
        ],
      },
      {
        name: "NoirWire's relayer",
        lines: [
          "Does not see your IP address.",
          "Sees the portfolio that sends or lends, and who it sends to.",
          "Every action it pays for names the same relayer on chain, so an observer can tell a portfolio uses NoirWire and can group NoirWire portfolios as a set. That does not link them to you, to your main wallet or to each other.",
        ],
      },
    ],
    phraseTitle: "Your recovery phrase",
    phraseBody:
      "Anyone with your recovery phrase can take everything in every portfolio. Never share it, never type it into a website, and never reuse it for another wallet.",
  },

  risks: {
    title: "Risks",
    sections: [
      {
        title: "What a tracker is",
        body: "A tracker is an xStocks certificate that follows the price of a company or a fund. It is not a share in that company or fund. It gives you no voting rights and no claim on the company. Its price can fall, and you can lose money.",
      },
      {
        title: "What the issuer controls",
        body: "The issuer of a tracker can freeze it, and can move or burn tokens without your signature. Dividends are not paid in cash: the issuer reinvests them by adjusting the token. xStocks are not offered in the United States, to US persons or in the issuer's prohibited countries.",
      },
      {
        title: "What stays public",
        body: "Every trade, transfer and balance of a portfolio is public on chain, with its amount and time. Private funding makes a portfolio harder to link to your main wallet. It does not hide what the portfolio does, and amounts and timing can still let someone infer a link.",
      },
      {
        title: "Lending through Earn",
        body: "USDC in Earn is lent through Jupiter Lend. It is not a bank deposit and is not insured. The rate changes. A fault in the lending program can cause loss. When the pool is heavily borrowed, a withdrawal can be delayed.",
      },
      {
        title: "The software",
        body: "NoirWire's software has not been independently audited. It checks every transaction before signing it, but software can have faults.",
      },
      {
        title: "Your recovery phrase",
        body: "Only your recovery phrase can restore this wallet. NoirWire does not have it and cannot recover it, your password, or your funds. Anyone who has the phrase can take everything.",
      },
    ],
  },

  about: {
    title: "About",
    version: "Version",
    build: "Build",
    network: "Network",
    networkValue: "Solana",
    risks: "Risks",
    copied: "Copied",
    developmentBuild: "Development",
    help: "Help",
    helpContact: "ph1l1ph@proton.me",
    website: "Website",
    websiteValue: "noirwire.com",
  },
} as const;
