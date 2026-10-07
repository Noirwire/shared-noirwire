import type { PendingWords } from "../application/ports.js";
import { fundingCopy } from "../copy/funding.js";
import { pendingActionCopy as copy } from "../copy/pendingAction.js";
import { shownAmountWith, type ShownUnits } from "./amount.js";

/** How a reserved action is named, with amounts shown at the multipliers `units` knows. */
export function pendingWords(units: ShownUnits): PendingWords {
  const amount = (symbol: string, held: number) => shownAmountWith(units, symbol, held);
  return {
    moving: (symbol, held, portfolio) => copy.what.moving(amount(symbol, held), portfolio),
    privateTransfer: (symbol, held, portfolio) =>
      copy.what.privateTransfer(amount(symbol, held), portfolio ?? fundingCopy.wallet.title),
    send: (symbol, held) => copy.what.send(amount(symbol, held)),
    trade: (side, symbol) => copy.what.trade(side, symbol),
    openingHoldings: () => copy.what.openingHoldings,
    earn: (action) => copy.what.earn(action),
  };
}

/** Where an action was reserved: a portfolio, or the funding wallet moving money into one. */
type PendingScope = "portfolio" | "funding";

/**
 * How far the last action has got, as far as a screen is concerned:
 * `unresolved` when the chain has nothing to settle it by, `waiting` while it
 * may still land, and how it ended once it has.
 */
type PendingStatus = "unresolved" | "waiting" | "landed" | "expired";

/** What a screen says about the last action of `scope`, described as `what`. */
export function pendingActionNote(scope: PendingScope, what: string, status: PendingStatus) {
  const subject = copy.subject[scope];
  switch (status) {
    case "unresolved":
      return copy.unresolved(subject, what, copy.balance[scope]);
    case "waiting":
      return copy.waiting(subject, what);
    case "landed":
      return copy.landed(subject, what);
    case "expired":
      return copy.expired(subject, what);
  }
}

type PendingActionNoteView = {
  note: string;
  /** Offered only when the user alone can release the action, and asked about once more first. */
  clear:
    | { asking: false; label: string }
    | { asking: true; warning: string; confirm: string; keep: string }
    | null;
};

/** The note under a review while the last action is unsettled or has just settled. */
export function pendingActionNoteView({
  note,
  clearable,
  confirming,
}: {
  note: string | null;
  clearable: boolean;
  confirming: boolean;
}): PendingActionNoteView | null {
  if (!note) return null;
  if (!clearable) return { note, clear: null };
  return {
    note,
    clear: confirming
      ? { asking: true, warning: copy.clearWarning, confirm: copy.clearConfirm, keep: copy.keep }
      : { asking: false, label: copy.clear },
  };
}
