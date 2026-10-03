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
} as const;
