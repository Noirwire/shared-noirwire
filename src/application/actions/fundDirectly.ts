import type { Signer, StillUnlocked } from "../ports.js";
import { FUNDING } from "../pendingActions.js";
import { refused, refusedFor, type Attempt } from "../result.js";
import {
  activePortfolio,
  logged,
  mapPortfolio,
  positive,
  setRealHolding,
} from "../walletRecord.js";
import {
  counted,
  failedOf,
  openSession,
  unknownOf,
  type ActionDeps,
  type Refresh,
} from "./common.js";

/** One real asset, SOL or a registered token, as the funding and send paths move it. */
export type AssetMoves<K extends Signer> = {
  symbol: string;
  balance(address: string): Promise<number>;
  /** Makes sure `owner` can receive the asset, paid by `funder`. */
  ensureAccount(owner: K, funder: K, stillUnlocked: StillUnlocked): Promise<void>;
  deposit(funder: K, owner: K, amount: number, stillUnlocked: StillUnlocked): Promise<void>;
  withdraw(
    owner: K,
    funder: K,
    amount: number,
    to: string,
    stillUnlocked: StillUnlocked,
  ): Promise<void>;
};

export type FundDirectlyDeps<K extends Signer> = ActionDeps<K> & {
  /** The asset `symbol` names, or undefined when there is none to move. */
  asset(symbol: string): AssetMoves<K> | undefined;
  refresh: Refresh;
};

/**
 * Deposits `amount` of `symbol` ("SOL" or a registered token's symbol) from
 * the funding wallet straight into this portfolio's own balance. Reads the
 * real balance back after the deposit lands rather than trusting the amount
 * that was requested.
 */
export async function fundDirectly<K extends Signer>(
  deps: FundDirectlyDeps<K>,
  input: { portfolioId: string; amount: number; symbol: string },
): Promise<Attempt> {
  const { portfolioId: id, amount, symbol } = input;
  const { prices } = deps;

  // Plan: which portfolio, which asset, how much.
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const portfolio = activePortfolio(session.wallet, id);
  if (!portfolio || !positive(amount)) return refused("activePortfolioAmount");
  const handle = deps.asset(symbol);
  if (!handle) return refusedFor("unknownAsset", symbol);

  // Guard: both keys are the ones for the addresses on screen.
  const funder = session.fundingSigner();
  const owner = session.portfolioSigner(portfolio);
  if (!funder || !owner) return refused(session.refusal());

  // Reserve against the funding wallet, which is what signs: one move of
  // money at a time, and never the same one twice.
  const reservation = await deps.pending.reserve(
    FUNDING,
    session.wallet.funding.address,
    deps.words.moving(handle.symbol, amount, portfolio.label),
  );
  if (!reservation) return refused("actionPending");
  let outcome: unknown;

  try {
    // Sign and submit.
    await handle.ensureAccount(owner, funder, session.live);
    await handle.deposit(funder, owner, amount, session.live);

    // Settle: what the chain now holds.
    const newBalance = await handle.balance(owner.publicKey.toBase58());
    deps.store.update((current) =>
      logged(
        mapPortfolio(current, id, (entry) =>
          setRealHolding(prices, entry, handle.symbol, newBalance),
        ),
        {
          portfolioId: id,
          kind: "fund",
          symbol: handle.symbol,
          amount,
          usd: amount * prices.price(handle.symbol),
        },
        prices,
      ),
    );
    void deps.refresh.funding(session.wallet.funding.address, handle.symbol);
    deps.track("funded_directly");
    return { kind: "confirmed", settlement: "balancesRead" };
  } catch (error) {
    outcome = error;
    const unknown = unknownOf(error);
    if (!unknown) {
      return counted(deps, "funding_failed", { route: "direct" }, failedOf("fundingFailed", error));
    }
    await Promise.allSettled([
      deps.refresh.portfolioAsset(id, portfolio.address, handle.symbol),
      deps.refresh.funding(session.wallet.funding.address, handle.symbol),
    ]);
    return unknown;
  } finally {
    await reservation.finish(outcome);
  }
}
