/** An action under way that needs nothing more from the person. Said the same wherever it is said. */
export const stillWorkingOnAction =
  "Still working. You can leave this open; nothing more is needed from you.";

/**
 * What the app says while something takes time, by what is being waited
 * for: content loading, something typed being checked, a review being
 * prepared, an action being carried out. None of it says what is asked of
 * whom: a person waits for their balance, not for a request.
 */
export const waitingCopy = {
  label: {
    content: "Loading",
    check: "Checking...",
    review: "Preparing your review...",
    action: "Working on it...",
  },
  stillWorking: {
    content: "Still loading. This is taking longer than usual.",
    check: "Still checking. This is taking longer than usual.",
    review: "Still preparing your review. Nothing has been sent.",
    action: stillWorkingOnAction,
  },
  /** What a wait that ran past its limit (`WAIT_LIMIT_MS`) ends with, by what was being waited for. */
  overdue: {
    check: "We couldn't check this. Nothing was sent. Try again.",
    review: "We couldn't prepare your review. Nothing was sent. Try again.",
    action:
      "This is taking much longer than it should. It may still go through. You can close this and check Activity before trying again.",
    save: "Saving your wallet is taking much longer than it should. It is still being saved. Keep this tab open.",
  },
  /** Why a dialog with an action under way will not close. */
  actionHeld: "This is still being carried out, so it can't be closed yet.",
  /** The app before it has checked what it is connected to. */
  gettingReady: "Getting things ready...",
} as const;

/** What the phone says differently when a wait ran past its limit, and for its own reads. Everything else is `waitingCopy`. */
export const mobileWaitingCopy = {
  overdue: {
    action:
      "This is taking longer than it should. It may still go through, so check the balance and Activity before doing it again.",
    prices:
      "We couldn't load prices. They are missing or out of date here, and are asked for again every half minute.",
    chart: "We couldn't load this chart.",
    earn: "We couldn't update what is in Earn. What you see may be out of date.",
    fundingBalance: "We couldn't read your funding wallet's balance.",
  },
} as const;
