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
    `Live trading runs on Solana mainnet. You can explore trackers on ${network}.`,

  /** A reveal control's accessible name: "Show the password", "Hide the recovery phrase". */
  showLabel: (label: string) => `Show ${label}`,
  hideLabel: (label: string) => `Hide ${label}`,
  /** A stepper control's accessible name: "Increase the weight", "Decrease the weight". */
  increaseLabel: (label: string) => `Increase ${label}`,
  decreaseLabel: (label: string) => `Decrease ${label}`,
  /** A stepper's value, read out by a screen reader. */
  percentSpoken: (value: number) => `${value} percent`,
  /** A close control's accessible name, where the plain "Close" would be ambiguous. */
  closeLabel: (title: string) => `Close ${title}`,
  nothingHereYet: "Nothing here yet",
  /** Asked before leaving a sheet with something typed into it. */
  discardThis: "Discard this?",
  keepEditing: "Keep editing",
  discard: "Discard",
  /** The word for each state of a step in a progress list. */
  stepStatus: {
    waiting: "Waiting",
    current: "In progress",
    done: "Done",
    failed: "Failed",
    skipped: "Not done",
  },
  /** Joins a list the way a sentence does: "SOL", "SOL and USDC", "SOL, USDC and SPYx". */
  andList: (items: readonly string[]): string =>
    items.length <= 1
      ? (items[0] ?? "")
      : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`,
} as const;
