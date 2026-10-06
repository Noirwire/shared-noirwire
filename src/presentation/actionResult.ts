import type {
  ActionResult,
  Failed,
  FailureReason,
  RefusalReason,
  Refused,
  Unsuccessful,
} from "../application/result.js";
import { saysTransportFailure } from "../application/retries.js";
import type { ChainErrorCode } from "../domain/chainError.js";
import type { AppPlatform } from "../domain/appPlatform.js";
import { errorsCopy as copy, mobileErrorsCopy } from "../copy/errors.js";
import { networkCostCopy } from "../copy/networkCost.js";
import { mobilePendingActionCopy, pendingActionCopy } from "../copy/pendingAction.js";
import { walletCopy } from "../copy/wallet.js";

/** The words that name where the wallet is kept, which differ by platform. */
function placeWords(platform: AppPlatform) {
  return platform === "mobile"
    ? { notRecorded: mobilePendingActionCopy.notRecorded, ...mobileErrorsCopy }
    : { notRecorded: pendingActionCopy.notRecorded, portfolioNotSaved: copy.portfolioNotSaved };
}

/** What a person is told when a step stopped for `code`. */
export function chainErrorMessage(code: ChainErrorCode, platform: AppPlatform = "web"): string {
  return code === "notRecorded" ? placeWords(platform).notRecorded : copy.chain[code];
}

const REFUSALS: Record<RefusalReason, (symbol: string, platform: AppPlatform) => string> = {
  actionPending: () => pendingActionCopy.stillPending,
  costUnavailable: () => networkCostCopy.notNow,
  notRecorded: (_symbol, platform) => placeWords(platform).notRecorded,
  walletLocked: () => copy.chain.walletLocked,
  keyMismatch: () => walletCopy.keyMismatch,
  portfolioInactive: () => copy.portfolioInactive,
  portfolioGone: () => copy.portfolioGone,
  portfolioNotSaved: (_symbol, platform) => placeWords(platform).portfolioNotSaved,
  unusedPortfolios: () => copy.unusedPortfolios,
  duplicateName: () => copy.duplicateName,
  activePortfolioAmount: () => copy.activePortfolioAmount,
  amountAboveZero: () => copy.amountAboveZero,
  unknownAsset: (symbol) => copy.unknownAsset(symbol),
  notPrivate: (symbol) => copy.funding.notPrivate(symbol),
  notTransferable: (symbol) => copy.send.notTransferable(symbol),
  sendNotCompleted: () => copy.send.notCompleted,
  moreThanOnchain: () => copy.send.moreThanOnchain,
  moreThanFunding: () => copy.send.moreThanMainWallet,
  ownPortfolioFromFunding: () => copy.send.useMove,
  tradingMainnetOnly: () => copy.trade.mainnetOnly,
  notTradable: (symbol) => copy.trade.notTradable(symbol),
  earnMainnetOnly: () => copy.earn.mainnetOnly,
};

/** What a person is told when an action is refused before anything is signed. */
export function refusalMessage(
  result: Pick<Refused, "reason" | "symbol">,
  platform: AppPlatform = "web",
): string {
  return REFUSALS[result.reason](result.symbol ?? "", platform);
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

/** A status a service answered with, as a failed request words it: "502 Bad Gateway", "returned 502". */
const STATUS_WORDS = /^\d{3}\b|\breturned \d{3}\b/;

/**
 * The chain's or a program's own account of a failure: JSON, an instruction
 * error, a program log, a hex code. `{"InstructionError":[0,{"Custom":1}]}`
 * tells a person nothing they can act on.
 */
const RAW_CHAIN_WORDS =
  /[{}[\]]|InstructionError|InsufficientFundsFor|\bCustom\b|custom program error|\b0x[0-9a-f]+\b|\bProgram (log|data|return|\w+ (failed|invoke|consumed|success))|AnchorError|Error (Code|Number):|Transaction simulation failed|SendTransactionError/i;

/** Whether `text` carries raw JSON or a chain or program error as the chain words it. */
export function saysRawChainError(text: string): boolean {
  return RAW_CHAIN_WORDS.test(text);
}

/**
 * Whether a failure's own account is about how the app asked, not about the
 * person's money: a request that did not get through, a status code, or the
 * chain's raw words for an error. A person is never told that; they are told
 * what it means for them. Every failure a view model shows passes here.
 */
function isTechnical(detail: string): boolean {
  return saysTransportFailure(detail) || STATUS_WORDS.test(detail) || saysRawChainError(detail);
}

/**
 * A failed attempt in its own account: the code's words, else what the
 * refusal itself said, else what the action was doing. This is what a
 * failure is counted under; a person is told `failureMessage`. An order that
 * failed after its account was opened says the cost is already paid.
 */
export function failureAccount(result: Failed, platform: AppPlatform = "web"): string {
  return withCostPaid(
    result,
    result.cause
      ? chainErrorMessage(result.cause, platform)
      : result.detail || FAILURES[result.reason],
  );
}

/** An order that failed after its account was opened says the cost is already paid. */
function withCostPaid(result: Failed, said: string): string {
  return result.reason === "orderNotPlaced" ? `${said} ${networkCostCopy.alreadyCovered}` : said;
}

/**
 * What a person is told when an attempt failed: the code's words, else the
 * refusal's own account unless that is about a request and not about their
 * money, else what the action was doing.
 */
export function failureMessage(result: Failed, platform: AppPlatform = "web"): string {
  const technical = !result.cause && result.detail !== undefined && isTechnical(result.detail);
  return technical
    ? withCostPaid(result, FAILURES[result.reason])
    : failureAccount(result, platform);
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
export function actionFailure<Review>(
  result: ActionResult<Review>,
  platform: AppPlatform = "web",
): ActionFailure<Review> | null {
  return result.kind === "confirmed" || result.kind === "submitted"
    ? null
    : describeFailure(result, platform);
}

/** The words and the next step for a result that did not go ahead. */
export function describeFailure<Review>(
  result: Unsuccessful<Review>,
  platform: AppPlatform = "web",
): ActionFailure<Review> {
  switch (result.kind) {
    case "refused":
      return { error: refusalMessage(result, platform) };
    case "unknown":
      return { error: chainErrorMessage("outcomeUnknown") };
    case "notLanded":
      return {
        error: copy.reviewCostAgain(chainErrorMessage("relayedNotLanded")),
        reviewAgain: "other",
      };
    case "failed":
      return {
        error: failureMessage(result, platform),
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
  platform: AppPlatform = "web",
): { ok: true } | ActionFailure<Review> {
  return actionFailure(result, platform) ?? { ok: true };
}
