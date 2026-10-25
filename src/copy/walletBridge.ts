/**
 * What the approval screen says when NoirWire Terminal asks this wallet for a
 * signature. The screen is drawn from what the wallet itself read in the
 * request; the terminal's own words are never shown.
 */
export const walletBridgeCopy = {
  where: { solana: "Solana", rollup: "Trading network" },
  check: "Check that this window says app.noirwire.com.",
  noFee: "No fee",
  fee: (sol: string, account: string) => `Network fee: up to ${sol} SOL, paid from ${account}`,
  checking: "Checking the network",
  refuse: "Refuse",
  approve: "Approve",
  details: "Details",
  expiresIn: (seconds: number) => `Refused automatically in ${seconds} s`,

  connect: {
    title: "NoirWire Terminal wants to connect",
    origin: (host: string) => `Asked by ${host}`,
    sees: "The terminal will see this account's address. Nothing moves without your approval in this window.",
    suggest: "Use a separate portfolio for trading.",
    busy: "Finish the action in progress first",
    neverAsks: "NoirWire never asks for your recovery phrase here.",
    refuse: "Refuse",
    connect: "Connect",
    neutral: "Open this from NoirWire Terminal",
  },

  signIn: {
    title: (account: string) => `Sign in to the trading network as ${account}`,
    lines: [
      "Lets the terminal read your private trading account for 30 days. This moves no money and signs no transaction.",
    ],
  },
  openTrader: {
    title: "Open your trading account",
    lines: [
      "NoirWire pays the fee. This moves no money.",
      "Whoever holds the 4 trading keys listed below can place and cancel orders with this account's collateral, including orders that lose it, but cannot withdraw it.",
      "Approve only if you just started this in the terminal on this device.",
    ],
  },
  setOrderKeys: {
    title: "Use this device for trading",
    lines: [
      "This replaces the account's current trading keys with the 4 listed below. Any device using the old keys stops trading.",
      "Whoever holds the new keys can place and cancel orders with this account's collateral, including orders that lose it, but cannot withdraw it.",
      "Approve only if you just started this in the terminal on this device.",
    ],
  },
  orderKeys: "Trading keys (select one to see it in full)",
  deposit: {
    title: (amount: string) => `Move ${amount} USDC into your trading account`,
    lines: ["From your balance on the trading network, into your own trading account."],
  },
  withdraw: {
    title: (amount: string) => `Withdraw ${amount} USDC from your trading account`,
    lines: ["Into your own balance on the trading network."],
  },
  depositToRollup: {
    title: (amount: string, account: string) =>
      `Move ${amount} USDC from ${account} into the trading network`,
    lines: ["From your own USDC on Solana, to your own balance on the trading network."],
  },
  withdrawToSolana: {
    title: (amount: string, account: string) => `Bring ${amount} USDC back to ${account}`,
    lines: ["From your own balance on the trading network, to your own USDC on Solana."],
  },

  refusals: {
    userRefused: "You refused the request. Nothing was signed.",
    expired: "The request expired. Nothing was signed.",
    busy: "Another request is waiting. Nothing was signed.",
    locked: "The wallet locked before the request was approved. Nothing was signed.",
    notAllowed: "The terminal asked for something this wallet does not sign. Nothing was signed.",
    notDecodable: "The request could not be read. Nothing was signed.",
    wrongNetwork: "The network is not the one NoirWire trades on. Nothing was signed.",
    networkUnchecked: "The network could not be checked. Nothing was signed. Try again.",
    pendingAction: "Finish the action in progress first. Nothing was signed.",
    unsafeBrowser: "This browser cannot keep your wallet safe across tabs. Nothing was signed.",
    staleChannel: "This window was connected to an older page. Connect again. Nothing was signed.",
  },
} as const;
