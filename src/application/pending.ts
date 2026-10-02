/**
 * A money action that was sent and not seen to land may still land, so
 * whatever it was for must not be done a second time until the chain has
 * settled the first: that is how one decision turns into two payments.
 *
 * It can always be settled eventually. A transaction is only valid until its
 * blockhash expires, so either the chain shows it, or the chain has moved
 * past the point where it could ever be included.
 *
 * One `PendingAction` tracks one intent. `intent` is the caller's own key for
 * what must not be repeated, for example a portfolio's id.
 */
export type PendingAction =
  | { status: "none" }
  /** Sent, with everything needed to look it up. */
  | { status: "submitted"; intent: string; signature: string; lastValidBlockHeight: number }
  /** Sent without a full receipt: a venue that pays the fee signs first, and may not have said. */
  | {
      status: "unknown";
      intent: string;
      signature?: string;
      lastValidBlockHeight?: number;
      sentAt: number;
    }
  /** The chain shows it took effect. */
  | { status: "landed"; intent: string }
  /** It can no longer take effect: it failed, or its time to land ran out. */
  | { status: "expired"; intent: string };

export type PendingEvent =
  | { type: "submitted"; intent: string; signature: string; lastValidBlockHeight: number }
  | {
      type: "sentUnseen";
      intent: string;
      signature?: string;
      lastValidBlockHeight?: number;
      now: number;
    }
  /**
   * One reading of the chain. `signatureStatus` is left out when there was no
   * signature to look up or the lookup failed, `finalizedHeight` when the
   * height could not be read.
   */
  | {
      type: "chainChecked";
      signatureStatus?: "confirmed" | "failed" | "notFound";
      finalizedHeight?: number;
      now: number;
    }
  /** The balances the action would have changed show that it did. The only proof of landing when there is no signature. */
  | { type: "effectObserved" }
  /** The person has been told how it ended. */
  | { type: "acknowledged" };

/**
 * How long an action with no known expiry is treated as possibly still on
 * its way. A blockhash is good for about a minute and a half at most; the
 * rest is for the finalized height that proves it to catch up.
 */
export const LONGEST_VALID_MS = 180_000;

export const NO_PENDING_ACTION: PendingAction = { status: "none" };

export function isUnsettled(
  pending: PendingAction,
): pending is Extract<PendingAction, { status: "submitted" | "unknown" }> {
  return pending.status === "submitted" || pending.status === "unknown";
}

/** The same intent cannot be confirmed again while its last action is unsettled. */
export function canConfirm(pending: PendingAction, intent: string): boolean {
  return !(isUnsettled(pending) && pending.intent === intent);
}

function hasRunOutOfTime(
  pending: Extract<PendingAction, { status: "submitted" | "unknown" }>,
  finalizedHeight: number | undefined,
  now: number,
): boolean {
  if (pending.lastValidBlockHeight !== undefined) {
    return finalizedHeight !== undefined && finalizedHeight > pending.lastValidBlockHeight;
  }
  // With no expiry to wait for, the clock is the only thing that ends this.
  return pending.status === "unknown" && now - pending.sentAt > LONGEST_VALID_MS;
}

export function pendingReducer(pending: PendingAction, event: PendingEvent): PendingAction {
  switch (event.type) {
    case "submitted": {
      if (isUnsettled(pending)) return pending;
      const { intent, signature, lastValidBlockHeight } = event;
      return { status: "submitted", intent, signature, lastValidBlockHeight };
    }
    case "sentUnseen": {
      if (isUnsettled(pending)) return pending;
      const { intent, signature, lastValidBlockHeight, now } = event;
      return {
        status: "unknown",
        intent,
        ...(signature === undefined ? {} : { signature }),
        ...(lastValidBlockHeight === undefined ? {} : { lastValidBlockHeight }),
        sentAt: now,
      };
    }
    case "chainChecked": {
      if (!isUnsettled(pending)) return pending;
      const { intent } = pending;
      // A status only counts for a signature that was ours to look up.
      const status = pending.signature === undefined ? undefined : event.signatureStatus;
      if (status === "confirmed") return { status: "landed", intent };
      if (status === "failed") return { status: "expired", intent };
      // Past its last valid height it can only be called expired once the
      // chain has also been asked for the signature and does not have it.
      const lookedUp = pending.signature === undefined || status === "notFound";
      return lookedUp && hasRunOutOfTime(pending, event.finalizedHeight, event.now)
        ? { status: "expired", intent }
        : pending;
    }
    case "effectObserved":
      return isUnsettled(pending) ? { status: "landed", intent: pending.intent } : pending;
    case "acknowledged":
      return isUnsettled(pending) ? pending : NO_PENDING_ACTION;
  }
}
