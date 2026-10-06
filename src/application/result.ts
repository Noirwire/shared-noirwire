import type { ChainErrorCode } from "../domain/chainError.js";
import type { Opens } from "../domain/networkCost.js";

/**
 * What became of one attempt at a money action, as codes and data. Words are
 * chosen in presentation (src/presentation/actionResult.ts).
 *
 * This is the shared package's `ActionResult`, widened by what the web app's
 * actions answer today: the refusals each one checks for, `failed` for an
 * attempt stopped by a venue's or a guard's own refusal, a confirmed or
 * submitted action whose signature the client did not hand back, and an
 * opened account found already open on an earlier attempt.
 */

/** Why a money action was refused before anything was signed. */
export type RefusalReason =
  | "actionPending"
  | "costUnavailable"
  | "notRecorded"
  | "walletLocked"
  | "keyMismatch"
  | "portfolioInactive"
  | "portfolioGone"
  | "portfolioNotSaved"
  /** Another portfolio of this wallet already has that name. */
  | "duplicateName"
  /** Too many portfolios in a row were never used; one more could be missed by an import. */
  | "unusedPortfolios"
  | "activePortfolioAmount"
  | "amountAboveZero"
  | "unknownAsset"
  | "notPrivate"
  | "notTransferable"
  | "sendNotCompleted"
  | "moreThanOnchain"
  /** The same, of a send from the funding wallet. */
  | "moreThanFunding"
  /** A send from the funding wallet to one of this wallet's own portfolios, which is what Move is for. */
  | "ownPortfolioFromFunding"
  | "tradingMainnetOnly"
  | "notTradable"
  | "earnMainnetOnly";

/** What an action was doing when it stopped with a `failed` result. */
export type FailureReason =
  | "fundingFailed"
  | "privateNotStarted"
  | "sendFailed"
  | "noPrice"
  | "tradeFailed"
  /** The order after an account opened for it, whose cost is already paid. */
  | "orderNotPlaced"
  | "holdingsNotOpened"
  | "earnFailed";

/**
 * An earlier step of a multi-step action that landed and is paid for,
 * whatever happens next. No `signature` when it was found already done.
 */
export type CompletedStep = { step: "accountOpened"; opens: Opens; signature?: string };

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
  /** Nothing more was signed or sent. `symbol` names the asset a refusal is about. */
  | ({ kind: "refused"; reason: RefusalReason; symbol?: string } & Completed)
  | ({ kind: "needsReview"; change: ReviewChange<Review> } & Completed)
  /** Sent, and not yet seen to land. */
  | { kind: "submitted"; signature: string; lastValidBlockHeight?: number }
  /** Sent, and the chain shows it did not land. Nothing of this step moved. */
  | ({ kind: "notLanded" } & Completed)
  | { kind: "confirmed"; signature?: string; settlement: Settlement }
  /** Sent, with no word on whether it landed. It may still land. */
  | ({ kind: "unknown"; signature?: string; lastValidBlockHeight?: number } & Completed)
  /**
   * Stopped by a refusal that is not one of the above: a guard's, a
   * venue's, or the chain's. `cause` when it was one the app has a code
   * for, `detail` with the refusal's own account otherwise.
   */
  | ({
      kind: "failed";
      reason: FailureReason;
      cause?: ChainErrorCode;
      detail?: string;
    } & Completed);

/** Every result but the two that mean the action went ahead. */
export type Unsuccessful<Review = never> = Exclude<
  ActionResult<Review>,
  { kind: "confirmed" | "submitted" }
>;

/** What an action answers that confirms itself and never hands back a transaction still to land. */
export type Attempt<Review = never> = Exclude<ActionResult<Review>, { kind: "submitted" }>;

export type Refused = Extract<ActionResult, { kind: "refused" }>;
export type Failed = Extract<ActionResult, { kind: "failed" }>;

const NOTHING_COMPLETED: readonly CompletedStep[] = [];

export function refused(
  reason: RefusalReason,
  completed: readonly CompletedStep[] = NOTHING_COMPLETED,
): Refused {
  return { kind: "refused", reason, completed };
}

/** A refusal about one asset, named by `symbol`. */
export function refusedFor(reason: RefusalReason, symbol: string): Refused {
  return { kind: "refused", reason, symbol, completed: NOTHING_COMPLETED };
}

/**
 * Whether the action went through and its new balances could not be read
 * back yet. It is a success: a screen says it was done and that balances
 * will update shortly, never that it failed.
 */
export function balancesUnread(result: ActionResult<unknown>): boolean {
  return result.kind === "confirmed" && result.settlement === "balancesEstimated";
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
    result.kind === "refused" ||
    result.kind === "needsReview" ||
    result.kind === "notLanded" ||
    result.kind === "failed";
  return ended && completedSteps(result).length === 0;
}
