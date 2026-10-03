import type { PendingAction } from "../domain/wallet.js";

/**
 * The life of one money action, from the moment it is confirmed until the
 * chain has settled it, in the shared package's names. An action that may
 * still land must not be done a second time: that is how one decision turns
 * into two payments.
 *
 *   none ──reserve──► reserved ──signed──► unknown ──submitted──► submitted
 *                       │                     │  ▲                    │
 *                       │                     │  └──outcomeUnknown────┤
 *                       │                     │                       │
 *                       └──released──► none   └──chain──► landed | expired ──► none
 *
 * Every transaction is written into the record as it is signed, before it
 * may leave this device (`signed`), so a record always says whether anything
 * could have been sent. `released` is the action ending with nothing of it
 * left that can land: it completed, it was refused before anything was sent,
 * or the chain shows it failed. Otherwise only chain evidence settles it,
 * never the device's clock, and `userCleared` removes one only when there is
 * no block height or blockhash to settle it by.
 *
 * Landed and expired are outcomes, not stored states: the record is removed
 * once either is known.
 */
export type PendingEvent =
  | {
      type: "reserve";
      id: string;
      at: number;
      what: string;
      activity?: PendingAction["activity"];
    }
  /** A transaction of the action was signed and may now leave this device. A later one replaces it. */
  | { type: "signed"; signature?: string; blockhash: string; lastValidBlockHeight?: number }
  /** Sent and accepted by a service that lands it later, such as a private transfer. */
  | { type: "submitted"; signature: string }
  /** Sent, with no word on whether it landed. */
  | { type: "outcomeUnknown"; signature?: string; lastValidBlockHeight?: number }
  | { type: "released" }
  /** One reading of the chain about it. */
  | { type: "chainChecked"; outcome: ChainOutcome }
  | { type: "userCleared" };

/**
 * What the chain says about an unsettled action: it landed, it expired (it
 * failed, or can no longer land), it may still land, or there is nothing to
 * settle it by.
 */
export type ChainOutcome = "landed" | "expired" | "pending" | "unknown";

/** Whether anything that names a transaction was written into it. */
export function signedSomething(pending: PendingAction): boolean {
  return Boolean(pending.signature || pending.blockhash || pending.lastValidBlockHeight);
}

/** Whether only the user can release it: there is neither a block height nor a blockhash to settle it by. */
export function userClearable(pending: PendingAction): boolean {
  return !pending.lastValidBlockHeight && !pending.blockhash;
}

/**
 * The pending action after `event`, or undefined once there is none. Returns
 * `pending` itself for an event that does not apply, so a caller can tell a
 * refused event by identity.
 */
export function pendingReducer(
  pending: PendingAction | undefined,
  event: PendingEvent,
): PendingAction | undefined {
  if (event.type === "reserve") {
    if (pending) return pending;
    const { id, at, what, activity } = event;
    return { status: "reserved", id, at, what, ...(activity ? { activity } : {}) };
  }
  if (!pending) return pending;
  switch (event.type) {
    case "signed": {
      const rest = { ...pending };
      delete rest.signature;
      delete rest.lastValidBlockHeight;
      return {
        ...rest,
        status: "unknown",
        ...(event.signature ? { signature: event.signature } : {}),
        blockhash: event.blockhash,
        ...(event.lastValidBlockHeight ? { lastValidBlockHeight: event.lastValidBlockHeight } : {}),
      };
    }
    case "submitted":
      return {
        ...pending,
        status: pending.lastValidBlockHeight ? "submitted" : "unknown",
        signature: event.signature,
      };
    case "outcomeUnknown":
      return {
        ...pending,
        status: "unknown",
        ...(event.signature ? { signature: event.signature } : {}),
        ...(event.lastValidBlockHeight ? { lastValidBlockHeight: event.lastValidBlockHeight } : {}),
      };
    case "released":
      return undefined;
    case "chainChecked":
      return event.outcome === "landed" || event.outcome === "expired" ? undefined : pending;
    case "userCleared":
      return userClearable(pending) ? undefined : pending;
  }
}
