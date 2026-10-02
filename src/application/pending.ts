/**
 * The life of one money action, from the moment it is confirmed until the
 * chain has settled it. An action that may still land must not be done a
 * second time: that is how one decision turns into two payments.
 *
 *   none ──reserve──► reserved ──submitted──► submitted ──chain──► landed | expired
 *                       │   │                     │
 *                       │   └──outcomeUnknown──►  unknown ──chain──► landed | expired
 *                       │                         │
 *        releasedBeforeSend (nothing left         └──userCleared (no block height only)──► none
 *        the device) ──► none
 *
 * Only chain evidence settles an action. The device's clock never does.
 */
export type PendingAction =
  | { status: "none" }
  /** Confirmed and recorded before anything is signed. */
  | { status: "reserved" }
  /** Sent, with the signature and last valid block height of the exact transaction. */
  | { status: "submitted"; signature: string; lastValidBlockHeight: number }
  /** Something may have left the device, and what became of it is not known. */
  | { status: "unknown"; signature?: string; lastValidBlockHeight?: number }
  /** The chain shows it took effect. */
  | { status: "landed"; signature?: string }
  /** The chain shows it can no longer take effect: it failed, or its block height passed. */
  | { status: "expired" };

export type PendingEvent =
  | { type: "reserve" }
  /** A failure certain to be before anything left the device: signing refused, the build threw. */
  | { type: "releasedBeforeSend" }
  | { type: "submitted"; signature: string; lastValidBlockHeight: number }
  /** Any failure after the transaction may have left the device. */
  | { type: "outcomeUnknown"; signature?: string; lastValidBlockHeight?: number }
  /**
   * One reading of the chain, supplied by the caller from the RPC. Each field
   * is left out when it could not be read. `effect` is what the balances the
   * action would change show, read at or after `blockHeight`.
   */
  | {
      type: "chainChecked";
      signatureStatus?: "confirmed" | "failed" | "notFound";
      blockHeight?: number;
      effect?: "seen" | "absent";
    }
  /** The person has confirmed that an action with no block height to wait for may be cleared. */
  | { type: "userCleared" }
  /** The person has been told how it ended. */
  | { type: "acknowledged" };

type Unsettled = Extract<PendingAction, { status: "reserved" | "submitted" | "unknown" }>;
type InFlight = Extract<PendingAction, { status: "submitted" | "unknown" }>;

export const NO_PENDING_ACTION: PendingAction = { status: "none" };

export function isUnsettled(pending: PendingAction): pending is Unsettled {
  return (
    pending.status === "reserved" || pending.status === "submitted" || pending.status === "unknown"
  );
}

/** An intent can be reserved again only once its last action has settled. */
export function canReserve(pending: PendingAction): boolean {
  return !isUnsettled(pending);
}

function pastLastValidHeight(pending: InFlight, blockHeight: number | undefined): boolean {
  return (
    pending.lastValidBlockHeight !== undefined &&
    blockHeight !== undefined &&
    blockHeight > pending.lastValidBlockHeight
  );
}

function settleFromChain(
  pending: InFlight,
  event: Extract<PendingEvent, { type: "chainChecked" }>,
): PendingAction {
  const { signature } = pending;
  if (event.effect === "seen")
    return signature ? { status: "landed", signature } : { status: "landed" };
  if (signature === undefined) {
    return event.effect === "absent" && pastLastValidHeight(pending, event.blockHeight)
      ? { status: "expired" }
      : pending;
  }
  if (event.signatureStatus === "confirmed") return { status: "landed", signature };
  if (event.signatureStatus === "failed") return { status: "expired" };
  return event.signatureStatus === "notFound" && pastLastValidHeight(pending, event.blockHeight)
    ? { status: "expired" }
    : pending;
}

/**
 * Returns `pending` itself for an event that does not apply, so a caller can
 * tell a refused event by identity.
 */
export function pendingReducer(pending: PendingAction, event: PendingEvent): PendingAction {
  switch (event.type) {
    case "reserve":
      return canReserve(pending) ? { status: "reserved" } : pending;
    case "releasedBeforeSend":
      return pending.status === "reserved" ? NO_PENDING_ACTION : pending;
    case "submitted":
      return pending.status === "reserved"
        ? {
            status: "submitted",
            signature: event.signature,
            lastValidBlockHeight: event.lastValidBlockHeight,
          }
        : pending;
    case "outcomeUnknown": {
      if (pending.status !== "reserved" && pending.status !== "submitted") return pending;
      const known: { signature?: string; lastValidBlockHeight?: number } =
        pending.status === "submitted" ? pending : {};
      const signature = event.signature ?? known.signature;
      const lastValidBlockHeight = event.lastValidBlockHeight ?? known.lastValidBlockHeight;
      return {
        status: "unknown",
        ...(signature === undefined ? {} : { signature }),
        ...(lastValidBlockHeight === undefined ? {} : { lastValidBlockHeight }),
      };
    }
    case "chainChecked":
      return pending.status === "submitted" || pending.status === "unknown"
        ? settleFromChain(pending, event)
        : pending;
    case "userCleared":
      return pending.status === "unknown" && pending.lastValidBlockHeight === undefined
        ? NO_PENDING_ACTION
        : pending;
    case "acknowledged":
      return pending.status === "landed" || pending.status === "expired"
        ? NO_PENDING_ACTION
        : pending;
  }
}
