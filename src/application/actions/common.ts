import { ChainError, isChainError, UnknownOutcomeError } from "../../domain/chainError.js";
import type { EventData, EventName, failureReason } from "../../domain/usageEvents.js";
import type { PendingAction, Portfolio } from "../../domain/wallet.js";
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
import { readWithRetries } from "../retries.js";
import { holdingIn, setRealHolding } from "../walletRecord.js";
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

/**
 * A session's portfolio by id and the signer for it, or why the action
 * cannot proceed. Any portfolio, archived included: unlike `activePortfolio`,
 * this does not refuse one that has been archived.
 */
export function sessionPortfolioSigner<K extends Signer>(
  session: Session<K>,
  id: string,
): Refused | { portfolio: Portfolio; owner: K } {
  const portfolio = session.wallet.portfolios.find((entry) => entry.id === id);
  if (!portfolio) return refused("portfolioGone");
  const owner = session.portfolioSigner(portfolio);
  if (!owner) return refused(session.refusal());
  return { portfolio, owner };
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

/**
 * Ends a reservation with what the action came to. What the action answers
 * is already decided by then, so a record that cannot be written does not
 * change it: the reservation stays, and the chain settles it later.
 */
export async function ended(reservation: Reservation, outcome?: unknown): Promise<void> {
  await reservation.finish(outcome).catch(() => undefined);
}

/**
 * A read made after an action landed, to show what it left. Asked again on a
 * busy moment, and null when it still cannot be had: the action went
 * through whatever this read does, and nothing here may say otherwise.
 */
export async function readAfterLanding<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await readWithRetries(read);
  } catch {
    return null;
  }
}

const CASH_UNIT = 1_000_000;

/** A relayer's fee as the cash it is: raw USDC units to USDC. Nothing when the relayer was not paid. */
export function costInCash(relayerFeeRaw: bigint | undefined): number {
  return relayerFeeRaw === undefined ? 0 : Number(relayerFeeRaw) / CASH_UNIT;
}

/**
 * `portfolio` with its cash changed by `delta`, never below nothing: what an
 * action that landed is known to have taken or brought, standing in until
 * the next refresh reads the chain. The network cost a relayer was paid is
 * taken off this way, so cash does not read as it did before the action.
 */
export function withCashMoved(
  prices: Pick<PriceReader, "price" | "isPosition">,
  portfolio: Portfolio,
  cashSymbol: string,
  delta: number,
): Portfolio {
  if (delta === 0) return portfolio;
  const held = holdingIn(portfolio, cashSymbol).amount;
  const next = Math.max(Math.round((held + delta) * CASH_UNIT) / CASH_UNIT, 0);
  return setRealHolding(prices, portfolio, cashSymbol, next);
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
