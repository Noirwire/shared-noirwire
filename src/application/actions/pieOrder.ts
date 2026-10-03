import type { OrderTerms } from "../../domain/order.js";
import type { Signer, StillUnlocked } from "../ports.js";
import { refused, type Attempt, type CompletedStep } from "../result.js";
import { othersOf } from "../walletRecord.js";
import {
  costChangedOf,
  ended,
  failedOf,
  openSession,
  unknownOf,
  type ActionDeps,
  type Refresh,
} from "./common.js";

/**
 * Places a pie's orders one at a time, on the terms the user reviewed.
 *
 * Orders run in sequence, not in parallel: every buy spends the same cash
 * account, and each one is checked by simulating it against the balances it
 * will actually meet. Two in flight at once would each be checked against
 * cash the other is about to spend.
 *
 * A firm price that expires before its turn is a new order. It is placed
 * without asking only when it is no worse on every term the user saw - no
 * more spent, at least the same minimum received, no higher fee. Anything
 * else waits for an explicit yes.
 *
 * The run stops at the first failure, and after an order that landed but
 * whose balances could not be read back - the next one would be sized against
 * cash nobody has confirmed. A failed submission does not prove nothing
 * landed either, so the caller re-reads the chain before anything is tried
 * again, rather than this retrying blind.
 */

type LegRun<P> = { symbol: string; plan: P };

type LegStatus = "waiting" | "placing" | "done" | "failed" | "not placed";

/**
 * Why a leg stopped the run: its new price had no fee that could be checked,
 * or was worse and not accepted; the order's own answer, `error`, in the
 * words the caller's `submit` or `requote` gave it; or a throw, with the
 * thrower's own account when there was one.
 */
export type LegStop<E> =
  | { because: "feeUnknown" }
  | { because: "notAccepted" }
  | { because: "refused"; error: E }
  | { because: "threw"; detail?: string };

export type LegOutcome<E = string> = {
  symbol: string;
  status: LegStatus;
  stop?: LegStop<E>;
  /** Set on a placed order whose new balances could not be read back. The run stops after it. */
  unread?: true;
};

type Deps<P, E> = {
  now(): number;
  requote(symbol: string): Promise<{ plan: P } | { error: E }>;
  /** Asked only when a replacement price is worse than the reviewed one. */
  approve(symbol: string, reviewed: P, replacement: P): Promise<boolean>;
  submit(plan: P): Promise<{ ok: true; unconfirmed?: boolean } | { error: E }>;
  onChange(outcomes: LegOutcome<E>[]): void;
};

function isExpired(terms: OrderTerms, now: number) {
  return terms.quote.expiresAt !== undefined && now >= terms.quote.expiresAt;
}

export function noWorse(replacement: OrderTerms, reviewed: OrderTerms) {
  return (
    replacement.spend <= reviewed.spend &&
    replacement.receiveAtLeast >= reviewed.receiveAtLeast &&
    replacement.quote.feeBps !== undefined &&
    reviewed.quote.feeBps !== undefined &&
    replacement.quote.feeBps <= reviewed.quote.feeBps &&
    (replacement.quote.gasless === true || reviewed.quote.gasless !== true)
  );
}

/** A live plan for this leg: the reviewed one, or an approved replacement for an expired one. */
async function currentPlan<P extends OrderTerms, E>(
  leg: LegRun<P>,
  deps: Deps<P, E>,
): Promise<{ plan: P } | { stop: LegStop<E> }> {
  let plan = leg.plan;
  while (isExpired(plan, deps.now())) {
    const fresh = await deps.requote(leg.symbol);
    if ("error" in fresh) return { stop: { because: "refused", error: fresh.error } };
    if (fresh.plan.quote.feeBps === undefined) return { stop: { because: "feeUnknown" } };
    if (!noWorse(fresh.plan, leg.plan) && !(await deps.approve(leg.symbol, leg.plan, fresh.plan))) {
      return { stop: { because: "notAccepted" } };
    }
    plan = fresh.plan;
  }
  return { plan };
}

async function place<P extends OrderTerms, E>(
  leg: LegRun<P>,
  deps: Deps<P, E>,
): Promise<{ ok: true; unconfirmed?: boolean } | { stop: LegStop<E> }> {
  const live = await currentPlan(leg, deps);
  if ("stop" in live) return live;
  const placed = await deps.submit(live.plan);
  return "error" in placed ? { stop: { because: "refused", error: placed.error } } : placed;
}

export async function runLegs<P extends OrderTerms, E>(
  legs: LegRun<P>[],
  deps: Deps<P, E>,
): Promise<LegOutcome<E>[]> {
  const outcomes: LegOutcome<E>[] = legs.map((leg) => ({ symbol: leg.symbol, status: "waiting" }));
  const update = (index: number, outcome: Omit<LegOutcome<E>, "symbol">) => {
    outcomes[index] = { symbol: legs[index].symbol, ...outcome };
    deps.onChange([...outcomes]);
  };

  const stopAfter = (index: number) => {
    for (let rest = index + 1; rest < legs.length; rest++) update(rest, { status: "not placed" });
  };

  for (const [index, leg] of legs.entries()) {
    update(index, { status: "placing" });
    const result = await place(leg, deps).catch((error: unknown): { stop: LegStop<E> } => ({
      stop: {
        because: "threw",
        ...(error instanceof Error ? { detail: error.message } : {}),
      },
    }));
    if ("stop" in result) {
      update(index, { status: "failed", stop: result.stop });
      stopAfter(index);
      break;
    }
    if (result.unconfirmed) {
      update(index, { status: "done", unread: true });
      stopAfter(index);
      break;
    }
    update(index, { status: "done" });
  }
  return outcomes;
}

/** What opening a pie's tracker accounts asks of the chain and the relayer. */
export type HoldingsChain<K extends Signer, S> = {
  /** The stock `symbol` names, or undefined for one that is not listed. */
  stock(symbol: string): S | undefined;
  /**
   * Opens `owner`'s own account for `stock` at the relayer's expense.
   * Resolves to its signature, or null when the account was already there.
   */
  openHolding(input: {
    owner: K;
    stock: S;
    reviewedFeeRaw: bigint;
    keepOut: string[];
    stillUnlocked: StillUnlocked;
  }): Promise<string | null>;
};

export type OpenHoldingsDeps<K extends Signer, S> = ActionDeps<K> & {
  chain: HoldingsChain<K, S>;
  refresh: Pick<Refresh, "portfolioCash">;
};

/**
 * Opens this portfolio's accounts for the trackers a pie is about to buy
 * for the first time, one relayed transaction each, before its first order:
 * the venue builds each order only once the account it pays into exists.
 * One that is already open, from an earlier attempt, is not opened or
 * charged for again.
 */
export async function openHoldings<K extends Signer, S>(
  deps: OpenHoldingsDeps<K, S>,
  input: { portfolioId: string; symbols: string[]; reviewedFeeRaw: bigint },
): Promise<Attempt> {
  const { portfolioId: id, symbols, reviewedFeeRaw } = input;
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const portfolio = session.wallet.portfolios.find((entry) => entry.id === id);
  if (!portfolio) return refused("portfolioGone");
  const owner = session.portfolioSigner(portfolio);
  if (!owner) return refused(session.refusal());
  const reservation = await deps.pending.reserve(
    id,
    portfolio.address,
    deps.words.openingHoldings(),
  );
  if (!reservation) return refused("actionPending");
  let outcome: unknown;
  const completed: CompletedStep[] = [];
  /** Everything the portfolio holds, re-read. False when it could not be: never a reason to fail. */
  const reread = () => deps.refresh.portfolioCash(id, portfolio.address).catch(() => false);
  try {
    for (const symbol of symbols) {
      const stock = deps.chain.stock(symbol);
      if (!stock) continue;
      const opened = await deps.chain.openHolding({
        owner,
        stock,
        reviewedFeeRaw,
        keepOut: othersOf(session.wallet, portfolio),
        stillUnlocked: session.live,
      });
      completed.push({
        step: "accountOpened",
        opens: "holding",
        ...(opened ? { signature: opened } : {}),
      });
    }
  } catch (error) {
    outcome = error;
    await reread();
    return (
      unknownOf(error, completed) ??
      costChangedOf(error, completed) ??
      failedOf("holdingsNotOpened", error, completed)
    );
  } finally {
    await ended(reservation, outcome);
  }
  // Every account is open and paid for. A balance that cannot be re-read
  // does not undo that.
  return { kind: "confirmed", settlement: (await reread()) ? "balancesRead" : "balancesEstimated" };
}
