import type { Opens } from "../domain/networkCost.js";

/** Why a money action was refused before anything was signed. */
export type RefusalReason = "actionPending" | "costUnavailable" | "notRecorded";

/** An earlier step of a multi-step action that landed and is paid for, whatever happens next. */
export type CompletedStep = { step: "accountOpened"; opens: Opens; signature: string };

/** Why the review has to be shown again before anything is sent. */
export type ReviewChange<Review> =
  /** The price moved past what was reviewed. `replacement` is the review to show instead. */
  | { because: "priceMoved"; replacement: Review }
  /** The relayer's fee rose past what was reviewed. */
  | { because: "networkCostRose" }
  /** The relayer could not be used, so the cost has to be met another way. */
  | { because: "relayerUnavailable" };

/** How far a confirmed action's own effect was read back. */
export type Settlement =
  | "balancesRead"
  /** It landed, and the balances could not be read back: what is shown is the review's estimate. */
  | "balancesEstimated";

type Completed = { completed: readonly CompletedStep[] };

/**
 * What became of one attempt at a money action. `Review` is the review a
 * moved price replaces, which each action defines.
 */
export type ActionResult<Review = never> =
  /** Nothing more was signed or sent. */
  | ({ kind: "refused"; reason: RefusalReason } & Completed)
  | ({ kind: "needsReview"; change: ReviewChange<Review> } & Completed)
  /** Sent, and not yet seen to land. */
  | { kind: "submitted"; signature: string; lastValidBlockHeight: number }
  /** Sent, and the chain shows it did not land. Nothing of this step moved. */
  | ({ kind: "notLanded" } & Completed)
  | { kind: "confirmed"; signature: string; settlement: Settlement }
  /** Sent, with no word on whether it landed. It may still land. */
  | ({ kind: "unknown"; signature?: string; lastValidBlockHeight?: number } & Completed);

const NOTHING_COMPLETED: readonly CompletedStep[] = [];

export function refused(
  reason: RefusalReason,
  completed: readonly CompletedStep[] = NOTHING_COMPLETED,
): ActionResult {
  return { kind: "refused", reason, completed };
}

/** Whether the attempt left something that may still land, and so must be settled before the action is repeated. */
export function leavesPending(result: ActionResult<unknown>): boolean {
  return result.kind === "submitted" || result.kind === "unknown";
}

/** The earlier steps that landed, paid for, before the attempt ended. */
export function completedSteps(result: ActionResult<unknown>): readonly CompletedStep[] {
  return "completed" in result ? result.completed : NOTHING_COMPLETED;
}

/** Whether the attempt moved nothing at all and never can. */
export function movedNothing(result: ActionResult<unknown>): boolean {
  const ended =
    result.kind === "refused" || result.kind === "needsReview" || result.kind === "notLanded";
  return ended && completedSteps(result).length === 0;
}
