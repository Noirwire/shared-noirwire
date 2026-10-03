import type { NetworkCost } from "../../domain/networkCost.js";
import type { EarnAction } from "../earn.js";
import { planNetworkCost, type CostAgreed, type CostChain } from "../networkCost.js";
import type { RelayerQuote, Signer, StillUnlocked } from "../ports.js";
import { refused, type Settlement, type Unsuccessful } from "../result.js";
import { holdingIn, logged, othersOf, positive } from "../walletRecord.js";
import {
  costChangedOf,
  counted,
  ended,
  failedOf,
  openSession,
  unknownOf,
  type ActionDeps,
  type Refresh,
} from "./common.js";

/** What lending a portfolio's USDC asks of the lending venue and the relayer. */
export type EarnChain<K extends Signer> = {
  /** Whether Earn is possible on this network at all. */
  available(): boolean;
  /** Lends or withdraws, signed by the portfolio's own key, paying the network itself. Resolves to the signature. */
  move(action: EarnAction, owner: K, amount: number, stillUnlocked: StillUnlocked): Promise<string>;
  /** The same with the relayer paying the network and the portfolio paying it back. */
  moveRelayed(input: {
    action: EarnAction;
    owner: K;
    amount: number;
    reviewedFeeRaw: bigint;
    keepOut: string[];
    stillUnlocked: StillUnlocked;
  }): Promise<string>;
  /** The relayer's price for `action` of `amount` by `owner`. */
  quoteRelayed(action: EarnAction, owner: string, amount: number): Promise<RelayerQuote>;
  /** The symbol of the cash that is lent. */
  cashSymbol: string;
  cost: CostChain;
};

export type EarnDeps<K extends Signer> = ActionDeps<K> & {
  chain: EarnChain<K>;
  refresh: Pick<Refresh, "portfolioCash">;
};

/**
 * How the network cost of an Earn deposit or withdrawal is met. `sample`
 * is an amount the portfolio could really move, which is all the relayer
 * needs to price the action: its cost does not depend on the amount.
 */
export async function reviewEarnCost<K extends Signer>(
  deps: Pick<EarnDeps<K>, "store" | "prices" | "chain">,
  input: {
    portfolioId: string;
    action: EarnAction;
    lamportsNeeded: number;
    sample: number;
    withoutRelayer: boolean;
  },
): Promise<NetworkCost> {
  const { action, sample } = input;
  const { chain } = deps;
  const portfolio = deps.store
    .snapshot()
    ?.portfolios.find((entry) => entry.id === input.portfolioId);
  if (!portfolio) return { kind: "unavailable" };
  const owner = portfolio.address;
  try {
    return await planNetworkCost(
      {
        owner,
        lamportsNeeded: input.lamportsNeeded,
        cashFree: holdingIn(portfolio, chain.cashSymbol).amount,
        solPrice: deps.prices.price("SOL") || undefined,
        relayer:
          input.withoutRelayer || !positive(sample)
            ? undefined
            : {
                quote: () => chain.quoteRelayed(action, owner, sample),
                opens: action === "deposit" ? "earn" : "cash",
                // A withdrawal pays out of the USDC it returns, so a
                // portfolio whose cash is all lent can still take it back.
                paidFromProceeds: action === "withdraw",
              },
      },
      chain.cost,
    );
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Lends or withdraws this portfolio's USDC, signed by the portfolio's own
 * key. Allowed for an archived portfolio too, so money lent before archiving
 * can always come back out.
 */
export async function earn<K extends Signer>(
  deps: EarnDeps<K>,
  input: { portfolioId: string; action: EarnAction; amount: number; network?: CostAgreed },
): Promise<Unsuccessful | { kind: "confirmed"; signature: string; settlement: Settlement }> {
  const { portfolioId: id, action, amount, network } = input;
  const { chain, refresh } = deps;

  // Guard.
  if (!chain.available()) return refused("earnMainnetOnly");
  if (!positive(amount)) return refused("amountAboveZero");
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const portfolio = session.wallet.portfolios.find((entry) => entry.id === id);
  if (!portfolio) return refused("portfolioGone");
  const owner = session.portfolioSigner(portfolio);
  if (!owner) return refused(session.refusal());

  const entry = {
    kind: action === "deposit" ? ("earnDeposit" as const) : ("earnWithdraw" as const),
    symbol: chain.cashSymbol,
    amount,
    usd: amount * deps.prices.price(chain.cashSymbol),
  };
  const reservation = await deps.pending.reserve(
    id,
    portfolio.address,
    deps.words.earn(action),
    entry,
  );
  if (!reservation) return refused("actionPending");
  let outcome: unknown;
  let signature: string;
  /** Everything the portfolio holds, re-read. False when it could not be: never a reason to fail. */
  const reread = () => refresh.portfolioCash(id, portfolio.address).catch(() => false);

  try {
    // Sign and submit, with the network cost met the way the review showed.
    signature =
      network?.relayerFeeRaw !== undefined
        ? await chain.moveRelayed({
            action,
            owner,
            amount,
            reviewedFeeRaw: network.relayerFeeRaw,
            keepOut: othersOf(session.wallet, portfolio),
            stillUnlocked: session.live,
          })
        : await chain.move(action, owner, amount, session.live);
  } catch (error) {
    outcome = error;
    await reread();
    return (
      unknownOf(error) ??
      costChangedOf(error) ??
      counted(deps, "earn_failed", { action }, failedOf("earnFailed", error))
    );
  } finally {
    await ended(reservation, outcome);
  }

  // Settle. From here the move has landed, so nothing below may report it
  // as failed.
  const read = await reread();
  void deps.store
    .update((current) => logged(current, { portfolioId: id, ...entry }, deps.prices))
    .catch(() => false);
  deps.track(`earn_${action}`);
  return { kind: "confirmed", signature, settlement: read ? "balancesRead" : "balancesEstimated" };
}
