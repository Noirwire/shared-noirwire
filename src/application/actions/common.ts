import { ChainError, isChainError, UnknownOutcomeError } from "../../domain/chainError.js";
import type { EventData, EventName, failureReason } from "../../domain/usageEvents.js";
import type { PendingAction } from "../../domain/wallet.js";
import type { Reservation } from "../pendingActions.js";
import type {
  OpenSession,
  PendingWords,
  PriceReader,
  Session,
  Signer,
  Track,
  WalletStore,
} from "../ports.js";
import {
  refused,
  type ActionResult,
  type CompletedStep,
  type Failed,
  type FailureReason,
  type Refused,
  type Unsuccessful,
} from "../result.js";

/**
 * What every money action is built from. Each one runs the same lifecycle,
 * and says so in its own body: plan (what it would move), review (what it
 * costs), guard (the checks before anything is reserved), reserve, sign and
 * submit (through its chain client), and settle (read back what landed).
 */

export type FailureEvent = Extract<EventName, `${string}_failed`>;

/** The band a failure is counted under, from the words it is told with. */
export type FailureBand = ReturnType<typeof failureReason>;

/** What the use cases share: the session, the store, prices, analytics and the pending-action store. */
export type ActionDeps<K extends Signer> = {
  session: OpenSession<K>;
  store: WalletStore;
  prices: PriceReader;
  track: Track;
  /** How a failure is counted: by the words presentation tells it with. */
  failureBand(result: Failed): FailureBand;
  pending: {
    reserve(
      scope: string,
      address: string,
      what: string,
      activity?: PendingAction["activity"],
    ): Promise<Reservation | null>;
  };
  words: PendingWords;
};

/** The session, or the refusal that stands in for it. */
export function openSession<K extends Signer>(open: OpenSession<K>): Session<K> | Refused {
  const opened = open();
  return "refused" in opened ? refused(opened.refused) : opened;
}

const NOTHING: readonly CompletedStep[] = [];

/** A transaction that was sent with no word on whether it landed, or null for any other error. */
export function unknownOf(
  error: unknown,
  completed: readonly CompletedStep[] = NOTHING,
): Extract<ActionResult, { kind: "unknown" }> | null {
  if (!(error instanceof UnknownOutcomeError)) return null;
  return {
    kind: "unknown",
    ...(error.signature ? { signature: error.signature } : {}),
    ...(error.lastValidBlockHeight ? { lastValidBlockHeight: error.lastValidBlockHeight } : {}),
    completed,
  };
}

/**
 * What an action answers when the relayer it was reviewed with did not take
 * it and nothing was sent, or null for any other failure. One that was sent
 * and did not land is offered the other way next: sent without a priority
 * fee, it may simply have been crowded out.
 */
export function costChangedOf(
  error: unknown,
  completed: readonly CompletedStep[] = NOTHING,
): Extract<Unsuccessful, { kind: "needsReview" | "notLanded" }> | null {
  if (isChainError(error, "networkCostRose")) {
    return { kind: "needsReview", change: { because: "networkCostRose" }, completed };
  }
  if (isChainError(error, "relayerUnavailable")) {
    return { kind: "needsReview", change: { because: "relayerUnavailable" }, completed };
  }
  if (isChainError(error, "relayedNotLanded")) return { kind: "notLanded", completed };
  return null;
}

/**
 * A failure while `reason` was being done: by the error's code when it has
 * one, else by its own account of what went wrong.
 */
export function failedOf(
  reason: FailureReason,
  error: unknown,
  completed: readonly CompletedStep[] = NOTHING,
): Failed {
  if (error instanceof ChainError) return { kind: "failed", reason, cause: error.code, completed };
  const detail = error instanceof Error && error.message ? error.message : undefined;
  return { kind: "failed", reason, ...(detail ? { detail } : {}), completed };
}

/** Counts a failure, by the kind of failure it was, and hands it back. */
export function counted<K extends Signer>(
  deps: Pick<ActionDeps<K>, "track" | "failureBand">,
  name: FailureEvent,
  data: Omit<EventData, "reason">,
  result: Failed,
): Failed {
  deps.track(name, { ...data, reason: deps.failureBand(result) });
  return result;
}

/** Re-reads balances after an action, and stores them. See refreshBalances.ts. */
export type Refresh = {
  /** The funding wallet's balance of `symbol`. */
  funding(address: string, symbol: string): Promise<number>;
  /** One portfolio's balance of `symbol`. */
  portfolioAsset(id: string, address: string, symbol: string): Promise<number>;
  /** Everything one portfolio holds. False when the read failed. */
  portfolioCash(id: string, address: string): Promise<boolean>;
};
