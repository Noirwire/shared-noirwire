import { afterTrade } from "../../domain/holdings.js";
import type { NetworkCost } from "../../domain/networkCost.js";
import type { PricedOrder, Side } from "../../domain/order.js";
import { isChainError, UnknownOutcomeError } from "../../domain/chainError.js";
import { planNetworkCost, type CostAgreed, type CostChain } from "../networkCost.js";
import type { RelayerQuote, Signer, StillUnlocked } from "../ports.js";
import { readWithRetries } from "../retries.js";
import {
  refused,
  refusedFor,
  type Attempt,
  type CompletedStep,
  type Failed,
  type Refused,
} from "../result.js";
import {
  activePortfolio,
  holdingIn,
  logged,
  mapPortfolio,
  othersOf,
  positive,
  setHolding,
  setRealHolding,
} from "../walletRecord.js";
import { noWorse } from "./pieOrder.js";
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

/** A priced order as the venue returns it: its terms, and the stock it buys or sells. */
export type TradeOrder = PricedOrder & {
  stock: { symbol: string };
  quote: PricedOrder["quote"] & {
    /** True when the venue names the taker as the one who pays rent. */
    takerPaysRent?: boolean;
  };
};

/** What a trade asks of the swap venue, the chain and the relayer. */
export type TradeChain<K extends Signer, P extends TradeOrder> = {
  /** Whether live trading is possible on this network at all. */
  available(): boolean;
  isStock(symbol: string): boolean;
  /**
   * Prices an order. With `priceOnly`, a price with no order behind it, for a
   * portfolio that cannot pay the network yet. Rejects with a `noQuote`
   * `ChainError` when no router will take it.
   */
  plan(order: {
    owner: K;
    side: Side;
    symbol: string;
    amount: number;
    marketPrice?: number;
    priceOnly?: boolean;
  }): Promise<P>;
  /** Whether the order can be built and signed, or only shows a price. */
  isBuilt(plan: P): boolean;
  /** Builds, checks, signs and sends the order. Resolves to its signature once it landed. */
  execute(owner: K, plan: P, stillUnlocked: StillUnlocked): Promise<string>;
  /** The order size from which the venue pays the network fee itself, in dollars. */
  gaslessFromUsd: number;
  /** The symbol of the cash a trade spends and returns. */
  cashSymbol: string;
  /** Whether `owner` already has the account `stock` is held in. */
  holdingOpen(owner: string, stock: P["stock"]): Promise<boolean>;
  /** The relayer's price for opening that account. */
  quoteOpenHolding(owner: string, stock: P["stock"]): Promise<RelayerQuote>;
  /**
   * Opens `owner`'s own account for `stock` at the relayer's expense.
   * Resolves to its signature, or null when the account was already there.
   */
  openHolding(input: {
    owner: K;
    stock: P["stock"];
    reviewedFeeRaw: bigint;
    keepOut: string[];
    stillUnlocked: StillUnlocked;
  }): Promise<string | null>;
  /** `owner`'s balances of the stock and of the cash, read together. */
  tradeBalances(owner: string, stock: P["stock"]): Promise<[number, number]>;
  balanceOf(address: string, symbol: string): Promise<number>;
  cost: CostChain;
};

export type TradeDeps<K extends Signer, P extends TradeOrder> = ActionDeps<K> & {
  chain: TradeChain<K, P>;
  refresh: Refresh;
};

/** A portfolio whose balance is under this is treated as unable to pay an order's network cost. */
const NO_SOL_TO_SPEAK_OF = 0.001;

export type QuoteResult<P> = { kind: "quoted"; plan: P } | Refused | Failed;

/**
 * Prices a trade against the live router without committing to it.
 *
 * The returned plan carries the venue's own order, so placing it later
 * executes the exact route that was priced here. Re-quoting at submit time
 * would hand the user a different price than the one they agreed to, which
 * is the whole reason quote and place are two calls rather than one.
 */
export async function quoteTrade<K extends Signer, P extends TradeOrder>(
  deps: TradeDeps<K, P>,
  input: { portfolioId: string; side: Side; symbol: string; amount: number },
): Promise<QuoteResult<P>> {
  const { side, symbol, amount } = input;
  const { chain } = deps;
  if (!chain.available()) return refused("tradingMainnetOnly");
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const portfolio = activePortfolio(session.wallet, input.portfolioId);
  if (!portfolio || !positive(amount)) return refused("activePortfolioAmount");
  if (!chain.isStock(symbol)) return refusedFor("notTradable", symbol);

  const owner = session.portfolioSigner(portfolio);
  if (!owner) return refused(session.refusal());

  try {
    // Dollars per raw token from this site's own price feed, multiplier
    // included, for the quote to be held against. Zero means there is no
    // live price right now.
    const marketPrice = deps.prices.price(symbol) || undefined;
    const order = { owner, side, symbol, amount, marketPrice };
    // Jupiter prices nothing for a portfolio that cannot pay an order's
    // network cost. The review of such a trade shows a price with no
    // order behind it, and the order is priced once the cost is covered.
    const unpaid = holdingIn(portfolio, "SOL").amount < NO_SOL_TO_SPEAK_OF;
    // Pricing signs nothing, so a busy moment is asked again. "No price" is
    // an answer and is not.
    const plan = await readWithRetries(() => chain.plan(order)).catch((error: unknown) => {
      if (!unpaid || !isChainError(error, "noQuote")) throw error;
      return readWithRetries(() => chain.plan({ ...order, priceOnly: true }));
    });
    deps.track("trade_quoted", { side });
    return { kind: "quoted", plan };
  } catch (error) {
    return counted(deps, "trade_quote_failed", { side }, failedOf("noPrice", error));
  }
}

/**
 * How the network cost of a set of reviewed orders is met: one trade, or a
 * pie's. An order the venue pays for costs nothing here, and a portfolio
 * holding SOL of its own pays for the rest. Otherwise what can be done
 * depends on why the venue is not paying:
 *
 * - a buy it would not build, by a portfolio with no account for the
 *   tracker yet, is a first buy. The relayer opens that account, one
 *   transaction for each, after which the venue builds the order and pays
 *   for it;
 * - an order under the size the venue pays for is too small, and the
 *   review says what the smallest is;
 * - anything else has no price behind it right now.
 */
export async function reviewOrdersCost<K extends Signer, P extends TradeOrder>(
  deps: Pick<TradeDeps<K, P>, "store" | "prices" | "chain">,
  input: { portfolioId: string; plans: P[]; lamportsNeeded: number; withoutRelayer: boolean },
): Promise<NetworkCost> {
  const { plans, lamportsNeeded, withoutRelayer } = input;
  const { chain } = deps;
  const portfolio = deps.store
    .snapshot()
    ?.portfolios.find((entry) => entry.id === input.portfolioId);
  if (!portfolio) return { kind: "unavailable" };
  const owner = portfolio.address;
  const dollars = (plan: P) => (plan.side === "buy" ? plan.spend : plan.receive);
  const spent = plans.reduce((sum, plan) => sum + (plan.side === "buy" ? plan.spend : 0), 0);
  try {
    const unpaid = plans.filter((plan) => !plan.quote.gasless || plan.quote.takerPaysRent);
    const firstBuys: P[] = [];
    for (const plan of unpaid) {
      const candidate =
        plan.side === "buy" && !chain.isBuilt(plan) && dollars(plan) >= chain.gaslessFromUsd;
      if (!candidate) continue;
      const open = await readWithRetries(() => chain.holdingOpen(owner, plan.stock));
      if (!open) firstBuys.push(plan);
    }
    const onlyFirstBuys = firstBuys.length > 0 && firstBuys.length === unpaid.length;
    const cost = await planNetworkCost(
      {
        owner,
        lamportsNeeded,
        cashFree: holdingIn(portfolio, chain.cashSymbol).amount - spent,
        solPrice: deps.prices.price("SOL") || undefined,
        relayer:
          withoutRelayer || !onlyFirstBuys
            ? undefined
            : {
                // Every tracker's account is the same size, so one price holds for each.
                quote: () => chain.quoteOpenHolding(owner, firstBuys[0].stock),
                opens: "holding",
                count: firstBuys.length,
              },
      },
      chain.cost,
    );
    if (cost.kind !== "unavailable" || onlyFirstBuys) return cost;
    return unpaid.some((plan) => dollars(plan) < chain.gaslessFromUsd)
      ? { kind: "tooSmall", smallest: chain.gaslessFromUsd }
      : { kind: "noPrice" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * The price of a trade moved while the account for it was being opened, past
 * what was reviewed. The new plan rides along so the screen can show it for
 * a fresh confirmation instead of placing an order nobody agreed to.
 */
class PriceMoved<P> extends Error {
  constructor(readonly replacement: P) {
    super("priceMoved");
    this.name = "PriceMoved";
  }
}

/** An order that failed after the account it needed was opened and paid for. */
class OrderNotPlaced extends Error {
  constructor(readonly failure: unknown) {
    super("orderNotPlaced");
    this.name = "OrderNotPlaced";
  }
}

/**
 * Places a previously quoted trade, then re-reads both real balances from
 * the chain rather than trusting the quote's forecast.
 *
 * The cost basis moves here and only here: a buy adds the cash that
 * actually left, a sell removes the proportional share of what the position
 * cost. Every other write of a stock balance is a refresh, which must not
 * touch cost - see `setRealHolding`.
 */
export async function placeTrade<K extends Signer, P extends TradeOrder>(
  deps: TradeDeps<K, P>,
  input: { portfolioId: string; reviewed: P; network?: CostAgreed },
): Promise<Attempt<P>> {
  const { portfolioId: id, reviewed, network } = input;
  const { chain, prices, refresh } = deps;

  // Guard: an active portfolio, and its own key.
  const session = openSession(deps.session);
  if ("kind" in session) return session;
  const portfolio = activePortfolio(session.wallet, id);
  if (!portfolio) return refused("portfolioInactive");
  const owner = session.portfolioSigner(portfolio);
  if (!owner) return refused(session.refusal());
  const ownerAddress = owner.publicKey.toBase58();

  const reservation = await deps.pending.reserve(
    id,
    portfolio.address,
    deps.words.trade(reviewed.side, reviewed.stock.symbol),
  );
  if (!reservation) return refused("actionPending");
  let outcome: unknown;

  const cash = chain.cashSymbol;
  const stock = reviewed.stock;
  const stockBefore = holdingIn(portfolio, stock.symbol);
  const sharesBefore = stockBefore.amount;

  // The order that is really placed. It is the reviewed one unless that had
  // no order behind it, or expired while the network cost was being
  // covered: then it is priced again, and placed only if it is no worse on
  // every term the user reviewed.
  let plan = reviewed;
  let completed: CompletedStep[] = [];
  const place = async () => {
    const expired = !!plan.quote.expiresAt && Date.now() >= plan.quote.expiresAt;
    if (!chain.isBuilt(plan) || (completed.length > 0 && expired)) {
      const fresh = await chain.plan({
        owner,
        side: reviewed.side,
        symbol: stock.symbol,
        amount: reviewed.spend,
        marketPrice: prices.price(stock.symbol) || undefined,
      });
      if (!noWorse(fresh, reviewed)) throw new PriceMoved(fresh);
      plan = fresh;
    }
    return chain.execute(owner, plan, session.live);
  };

  // A first buy by a portfolio that cannot pay the network: the relayer
  // opens the account the tracker will be held in, and once that is
  // confirmed the venue builds the order and pays for it. One decision,
  // two steps. A step that is already done, on a second attempt, is not
  // done or charged again.
  const openThenPlace = async (reviewedFeeRaw: bigint) => {
    network?.onStep?.("covering");
    const opened = await chain.openHolding({
      owner,
      stock,
      reviewedFeeRaw,
      keepOut: othersOf(session.wallet, portfolio),
      stillUnlocked: session.live,
    });
    completed = [
      { step: "accountOpened", opens: "holding", ...(opened ? { signature: opened } : {}) },
    ];
    // The account is open and paid for; a balance that cannot be re-read
    // here does not stop the order it was opened for.
    await refresh.portfolioCash(id, portfolio.address).catch(() => false);
    network?.onStep?.("acting");
    try {
      return await place();
    } catch (error) {
      const passedOn =
        error instanceof PriceMoved ||
        error instanceof UnknownOutcomeError ||
        isChainError(error, "walletLocked");
      if (passedOn) throw error;
      throw new OrderNotPlaced(error);
    }
  };

  // Sign and submit.
  let signature: string;
  try {
    signature = await (network?.relayerFeeRaw !== undefined
      ? openThenPlace(network.relayerFeeRaw)
      : place());
  } catch (error) {
    outcome = error;
    // A moved price is not a failed order: nothing was sent.
    if (error instanceof PriceMoved) {
      return {
        kind: "needsReview",
        change: { because: "priceMoved", replacement: error.replacement as P },
        completed,
      };
    }
    const unknown = unknownOf(error, completed);
    if (!unknown) {
      return (
        costChangedOf(error, completed) ??
        counted(
          deps,
          "trade_failed",
          { side: plan.side },
          error instanceof OrderNotPlaced
            ? failedOf("orderNotPlaced", error.failure, completed)
            : failedOf("tradeFailed", error, completed),
        )
      );
    }
    // An unknown result is what stops a pie at this order: it places nothing
    // further, and nothing places this one again.
    await Promise.allSettled(
      [stock.symbol, cash].map((symbol) => refresh.portfolioAsset(id, portfolio.address, symbol)),
    );
    return unknown;
  } finally {
    await ended(reservation, outcome);
  }
  deps.track("trade_placed", { side: plan.side });

  // Settle. From here the trade has landed, so nothing below may report it
  // as failed: a pie would retry an order that already went through. When
  // the balances cannot be read back yet, the quote's figures stand in until
  // a refresh replaces them with what the chain holds.
  const balances = await chain.tradeBalances(ownerAddress, stock).catch(() => null);
  const cashBefore = portfolio.holdings.find((h) => h.symbol === cash)?.amount ?? 0;
  const [stockBalance, cashBalance] = balances ?? [
    plan.side === "buy" ? sharesBefore + plan.receive : Math.max(sharesBefore - plan.spend, 0),
    plan.side === "buy" ? Math.max(cashBefore - plan.spend, 0) : cashBefore + plan.receive,
  ];

  const traded = (balance: number) => afterTrade(stockBefore, plan, balance);

  deps.store.update((current) =>
    logged(
      mapPortfolio(current, id, (entry) =>
        setRealHolding(prices, setHolding(entry, traded(stockBalance)), cash, cashBalance),
      ),
      {
        portfolioId: id,
        kind: plan.side,
        symbol: stock.symbol,
        amount: plan.side === "buy" ? plan.receive : plan.spend,
        usd: plan.side === "buy" ? plan.spend : plan.receive,
      },
      prices,
    ),
  );
  if (!balances) {
    // The stock's real balance is still this trade's doing, so it is
    // recorded as traded, not as tokens that turned up from elsewhere.
    const reread = await Promise.allSettled([
      chain
        .balanceOf(portfolio.address, stock.symbol)
        .then((balance) =>
          deps.store.update((current) =>
            mapPortfolio(current, id, (entry) => setHolding(entry, traded(balance))),
          ),
        ),
      refresh.portfolioAsset(id, portfolio.address, cash),
    ]);
    if (reread.some((read) => read.status === "rejected")) {
      return { kind: "confirmed", signature, settlement: "balancesEstimated" };
    }
  }
  return { kind: "confirmed", signature, settlement: "balancesRead" };
}
