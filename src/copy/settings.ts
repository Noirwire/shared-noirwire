import { walletCopy } from "./wallet.js";

/** The settings screen. */
export const settingsCopy = {
  eyebrow: "More",
  title: "Settings",
  lead: "Manage your wallet, security and privacy in one place.",
  saveFailing:
    "Changes are not being saved in this browser (storage is full or blocked). What you see here will be gone after a reload. Your funds are not affected.",

  sections: {
    security: {
      title: "Security and recovery",
      help: "Keep access to your wallet and protect its recovery phrase.",
    },
    wallet: { title: "Wallet details", help: "Check what is held in your funding wallet." },
    privacy: { title: "Privacy", help: "Understand what is public and control usage analytics." },
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
    lead: "The phrase every portfolio in this wallet is derived from. It is the only way back in if you forget your password.",
    copyDescribe: "Copy recovery phrase",
    hide: "Hide phrase",
    hidesItself: "It hides again by itself after a minute.",
    passwordLabel: "Enter your password to show it",
    show: "Show",
    wrongPassword: walletCopy.store.wrongPassword,
    footnote:
      "Stored encrypted under your password. Anyone who has these words controls every portfolio this wallet derives, on any device. NoirWire will never ask you for them.",
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
    changed:
      "Password changed. Use the new one next time you unlock. This protects the copy in this browser only: if you think someone already copied this wallet, move your funds to a new recovery phrase.",
    reEncrypting: "Re-encrypting...",
    submit: "Change password",
  },

  funding: {
    title: "Funding wallet",
    description: "Balance and address for adding funds",
    lead: "Money sent here must be moved into a portfolio before you can invest.",
    assets: "USDC and network fees",
    advanced: "Advanced: funding address",
    copyDescribe: "Copy funding address",
  },

  protection: {
    title: "Privacy and your funds",
    description: "What others can see, on chain and off",
    value: "Read details",
    onChain: (assets: string, network: string) =>
      `Every portfolio, its ${assets} balances and every stock trade are real transactions on ${network}. Portfolio labels stay in this browser only.`,
    tradesPublic:
      "Trades are public on chain. Private funding makes them harder to link back to your known wallet. It does not make them invisible: amounts and timing may still be inferable.",
    relay:
      "Your keys and recovery phrase never leave this browser. Network requests are relayed by NoirWire's server, so the network provider, Jupiter and MagicBlock never see your IP address. The relay stores and logs nothing, but it is a relay you have to trust not to log. Those providers still see the addresses themselves, and requests made moments apart can let them guess that two addresses belong together.",
    relayer:
      "Actions paid through NoirWire's relayer show the same relayer address and payment account for every NoirWire portfolio. An observer can tell that a portfolio uses NoirWire and can group NoirWire portfolios as a set. That does not link them to a person, to your funding wallet or to each other directly.",
    phraseMainnet:
      "Anyone with your recovery phrase can take everything in every portfolio. Never share it, never type it into another site, and never reuse it for another wallet.",
    phraseTestNetwork: (network: string, tokens: string) =>
      `These addresses hold ${network} SOL and test tokens (${tokens}). Do not send mainnet funds here, and never reuse this recovery phrase for another wallet.`,
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
    description: "What can go wrong, stated once",
    value: "Read details",
    paragraphs: [
      "A tracker is a certificate that follows the price of a stock or fund. It is not a share: it carries no voting rights and no claim on the company.",
      "The issuer of a tracker keeps control over its own tokens. It can freeze them, and move or burn them without your signature.",
      "Balances, trades, transfers, amounts and timing are public on chain for every portfolio address. Private funding makes a portfolio harder to link to you. It does not hide what the portfolio does.",
      "USDC in Earn is lent out. The rate changes, withdrawals can be delayed while the pool is heavily borrowed, and a failure of the lending program can cause loss. It is not a bank deposit and is not insured.",
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
