/** Words more than one screen uses for the same thing. */
export const commonCopy = {
  back: "Back",
  cancel: "Cancel",
  close: "Close",
  continue: "Continue",
  done: "Done",
  confirm: "Confirm",
  max: "Max",
  save: "Save",
  restore: "Restore",
  archive: "Archive",
  archived: "Archived",
  active: "Active",
  checking: "Checking...",
  unavailable: "Unavailable",
  priceUnavailable: "Price unavailable",
  amountPlaceholder: "0.00",
  copy: "Copy",
  seeAll: "See all",
  /** The plain retry offered wherever a read or a check did not come back. */
  tryAgain: "Try again",
  cash: "Cash",
  solana: "Solana",
  tracker: (name: string) => `${name} tracker`,
  available: (amount: string) => `Available ${amount}`,
  readyToInvest: (amount: string) => `${amount} ready to invest`,
  /** After an action that went through whose new balances could not be read back yet. */
  balancesUpdateShortly: "Balances will update shortly.",
  /** An amount typed with more decimals than the asset has. `smallest` is its smallest amount, with its symbol. */
  tooPrecise: (smallest: string) =>
    `That amount has too many decimals. The smallest amount is ${smallest}.`,
  balanceUnavailable: "This token's balance cannot be shown right now. Try again in a moment.",
  tradingUnavailableOn: (network: string) =>
    `Live trading is unavailable on ${network}. You can explore trackers, but cannot place an order here.`,
} as const;
