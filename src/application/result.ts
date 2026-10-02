import { refusalCopy } from "../copy/refusal.js";

/** Why a money action was refused before anything was signed. */
export type RefusalReason = "actionPending" | "costUnavailable";

const REFUSAL_MESSAGES: Record<RefusalReason, string> = refusalCopy;

/** What became of one attempt at a money action. */
export type ActionResult =
  /** Nothing was signed or sent. */
  | { kind: "refused"; reason: RefusalReason; message: string }
  /** The terms changed since the review, so nothing was sent and the review is shown again. */
  | { kind: "needsReview" }
  /** Sent, and not yet seen to land. */
  | { kind: "submitted"; signature: string; lastValidBlockHeight: number }
  /** The chain shows it landed. */
  | { kind: "confirmed"; signature: string }
  /** Sent, with no word on whether it landed. It may still land. */
  | { kind: "unknown"; signature?: string; lastValidBlockHeight?: number };

export function refused(reason: RefusalReason): ActionResult {
  return { kind: "refused", reason, message: REFUSAL_MESSAGES[reason] };
}

/** Whether the attempt left something that may still land, and so must be settled before the action is repeated. */
export function leavesPending(result: ActionResult): boolean {
  return result.kind === "submitted" || result.kind === "unknown";
}

/** Whether the attempt moved nothing and can never move anything. */
export function movedNothing(result: ActionResult): boolean {
  return result.kind === "refused" || result.kind === "needsReview";
}
