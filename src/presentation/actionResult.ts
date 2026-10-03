import type {
  ActionResult,
  Failed,
  FailureReason,
  RefusalReason,
  Refused,
  Unsuccessful,
} from "../application/result.js";
import type { ChainErrorCode } from "../domain/chainError.js";
import { errorsCopy as copy } from "../copy/errors.js";
import { networkCostCopy } from "../copy/networkCost.js";
import { pendingActionCopy } from "../copy/pendingAction.js";
import { walletCopy } from "../copy/wallet.js";

const CHAIN: Record<ChainErrorCode, string> = {
  ...copy.chain,
  notRecorded: pendingActionCopy.notRecorded,
};

/** What a person is told when a step stopped for `code`. */
export function chainErrorMessage(code: ChainErrorCode): string {
  return CHAIN[code];
}

const REFUSALS: Record<RefusalReason, (symbol: string) => string> = {
  actionPending: () => pendingActionCopy.stillPending,
  costUnavailable: () => networkCostCopy.notNow,
  notRecorded: () => pendingActionCopy.notRecorded,
  walletLocked: () => copy.chain.walletLocked,
  keyMismatch: () => walletCopy.keyMismatch,
  portfolioInactive: () => copy.portfolioInactive,
  portfolioGone: () => copy.portfolioGone,
  portfolioNotSaved: () => copy.portfolioNotSaved,
  activePortfolioAmount: () => copy.activePortfolioAmount,
  amountAboveZero: () => copy.amountAboveZero,
  unknownAsset: (symbol) => copy.unknownAsset(symbol),
  notPrivate: (symbol) => copy.funding.notPrivate(symbol),
  notTransferable: (symbol) => copy.send.notTransferable(symbol),
  sendNotCompleted: () => copy.send.notCompleted,
  moreThanOnchain: () => copy.send.moreThanOnchain,
  tradingMainnetOnly: () => copy.trade.mainnetOnly,
  notTradable: (symbol) => copy.trade.notTradable(symbol),
  earnMainnetOnly: () => copy.earn.mainnetOnly,
};

/** What a person is told when an action is refused before anything is signed. */
export function refusalMessage(result: Pick<Refused, "reason" | "symbol">): string {
  return REFUSALS[result.reason](result.symbol ?? "");
}

const FAILURES: Record<FailureReason, string> = {
  fundingFailed: copy.funding.failed,
  privateNotStarted: copy.funding.privateNotStarted,
  sendFailed: copy.send.failed,
  noPrice: copy.trade.noPrice,
  tradeFailed: copy.trade.failed,
  orderNotPlaced: copy.trade.notPlaced,
  holdingsNotOpened: copy.trade.holdingsNotOpened,
  earnFailed: copy.earn.failed,
};

/**
 * What a person is told when an attempt failed: the code's words, else the
 * refusal's own account, else what the action was doing. An order that
 * failed after its account was opened says the cost is already paid.
 */
export function failureMessage(result: Failed): string {
  const said = result.cause
    ? chainErrorMessage(result.cause)
    : result.detail || FAILURES[result.reason];
  return result.reason === "orderNotPlaced" ? `${said} ${networkCostCopy.alreadyCovered}` : said;
}

/**
 * What a review does next, after an attempt that sent nothing because the
 * cost it was reviewed with no longer holds: "relayer" when the relayer's fee
 * rose, "other" when the relayer could not be used and the cost has to be met
 * another way. A relayer-paid transaction that did not land is offered the
 * other way: sent without a priority fee, it may simply have been crowded out.
 */
export type ReviewAgain = "relayer" | "other";

/** What a screen is handed back by a money action that did not complete. */
export type ActionFailure<Review> = {
  error: string;
  reviewAgain?: ReviewAgain;
  /** The network cost was paid even though the action was not done; the review need not charge it again. */
  costCovered?: true;
  /** The new review to show in place of one whose price moved. */
  replacement?: Review;
};

/**
 * The words and the next step for every result that is not a success.
 * `confirmed` and `submitted` have no failure to describe and answer null.
 */
export function actionFailure<Review>(result: ActionResult<Review>): ActionFailure<Review> | null {
  return result.kind === "confirmed" || result.kind === "submitted"
    ? null
    : describeFailure(result);
}

/** The words and the next step for a result that did not go ahead. */
export function describeFailure<Review>(result: Unsuccessful<Review>): ActionFailure<Review> {
  switch (result.kind) {
    case "refused":
      return { error: refusalMessage(result) };
    case "unknown":
      return { error: chainErrorMessage("outcomeUnknown") };
    case "notLanded":
      return {
        error: copy.reviewCostAgain(chainErrorMessage("relayedNotLanded")),
        reviewAgain: "other",
      };
    case "failed":
      return {
        error: failureMessage(result),
        ...(result.reason === "orderNotPlaced" ? { costCovered: true as const } : {}),
      };
    case "needsReview": {
      const { change } = result;
      if (change.because === "networkCostRose") {
        return {
          error: copy.reviewNewCost(chainErrorMessage("networkCostRose")),
          reviewAgain: "relayer",
        };
      }
      if (change.because === "relayerUnavailable") {
        return {
          error: copy.reviewCostAgain(chainErrorMessage("relayerUnavailable")),
          reviewAgain: "other",
        };
      }
      const covered = result.completed.length > 0;
      return {
        error: covered ? copy.trade.priceMovedWhileOpening : copy.trade.priceMoved,
        replacement: change.replacement,
        ...(covered ? { costCovered: true as const } : {}),
      };
    }
  }
}

/** What a screen is handed back by a money action: done, or what went wrong and what to do next. */
export function chainAnswer<Review>(
  result: ActionResult<Review>,
): { ok: true } | ActionFailure<Review> {
  return actionFailure(result) ?? { ok: true };
}
