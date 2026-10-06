/** A signed transaction could not be written into the record, where the wallet is kept. */
const notRecordedIn = (place: string) => `This could not be saved ${place}, so nothing was sent.`;

/**
 * What a screen says while a portfolio's last action, or the main wallet's
 * last move of money (into a portfolio, or a send), is reserved or not yet
 * settled, and how it ended.
 */
export const pendingActionCopy = {
  subject: {
    portfolio: "Your last action from this portfolio",
    funding: "Your last move of money from your main wallet",
  },
  balance: {
    portfolio: "this portfolio's balance",
    funding: "your main wallet's balance",
  },
  unresolved: (subject: string, what: string, where: string) =>
    `We could not confirm whether ${subject.charAt(0).toLowerCase()}${subject.slice(1)} (${what}) went through. Check ${where}; you can clear this once you have.`,
  waiting: (subject: string, what: string) =>
    `${subject} (${what}) is not confirmed yet. It may still go through, so nothing can be confirmed here until that is known. This is checked for you.`,
  landed: (subject: string, what: string) =>
    `${subject} (${what}) went through. Check the balance before doing it again.`,
  expired: (subject: string, what: string) =>
    `${subject} (${what}) did not go through, and no longer can. It is safe to try again.`,

  clear: "Clear",
  clearWarning:
    "Clearing does not prove it failed: it may still have gone through. Check the balance first, and clear it only if the balance shows it did not.",
  clearConfirm: "Yes, clear it",
  keep: "Keep it",

  /** What an action is answered with while an earlier one from the same portfolio is reserved or unsettled. */
  stillPending:
    "Your last action from this portfolio is not confirmed yet. Nothing more can be confirmed here until that is known.",
  notRecorded: notRecordedIn("in this browser"),

  /** What a reservation is called in the note, in the user's words. */
  what: {
    moving: (amount: string, portfolio: string) => `moving ${amount} into ${portfolio}`,
    privateTransfer: (amount: string, portfolio: string) =>
      `a private move of ${amount} into ${portfolio}`,
    send: (amount: string) => `a send of ${amount}`,
    trade: (side: "buy" | "sell", symbol: string) =>
      `${side === "buy" ? "a buy" : "a sale"} of ${symbol}`,
    openingHoldings: "opening accounts for trackers",
    earn: (action: "deposit" | "withdraw") =>
      action === "deposit" ? "adding to Earn" : "an Earn withdrawal",
  },
} as const;

/** What the phone says differently about a pending action. Everything else is `pendingActionCopy`. */
export const mobilePendingActionCopy = {
  notRecorded: notRecordedIn("on this phone"),
} as const;
