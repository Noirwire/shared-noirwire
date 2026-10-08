import { describe, expect, it, vi } from "vitest";
import {
  placeTrade,
  quoteTrade,
  reviewOrdersCost,
  type TradeChain,
  type TradeOrder,
} from "../../../src/application/actions/trade.js";
import { claimTrade } from "../../../src/application/actions/rewards.js";
import type { RewardsApi } from "../../../src/application/ports.js";
import { ChainError, UnknownOutcomeError } from "../../../src/domain/chainError.js";
import { actionFailure } from "../../../src/presentation/actionResult.js";
import {
  FUNDING_ADDRESS,
  harness,
  OTHER_ADDRESS,
  wallet,
  type FakeSigner,
} from "../support/actions.js";

type Plan = TradeOrder & { built: boolean };

function plan(over: Partial<Plan> = {}, quote: Partial<Plan["quote"]> = {}): Plan {
  return {
    side: "buy",
    stock: { symbol: "SPYx" },
    spend: 20,
    receive: 2,
    receiveAtLeast: 1.9,
    unitPrice: 10,
    venue: "Jupiter",
    priceChecked: true,
    built: true,
    ...over,
    quote: { feeBps: 50, gasless: true, ...quote },
  };
}

function chain(over: Partial<TradeChain<FakeSigner, Plan>> = {}): TradeChain<FakeSigner, Plan> {
  return {
    available: () => true,
    isStock: (symbol) => symbol === "SPYx",
    plan: vi.fn(async () => plan()),
    isBuilt: (entry) => entry.built,
    execute: vi.fn(async () => "trade-sig"),
    gaslessFromUsd: 12,
    cashSymbol: "USDC",
    holdingOpen: vi.fn(async () => true),
    quoteOpenHolding: vi.fn(async () => ({ feeRaw: 2_000_000n, opensAccount: true })),
    openHolding: vi.fn(async () => "open-sig"),
    tradeBalances: vi.fn(async (): Promise<[number, number]> => [2, 30]),
    balanceOf: vi.fn(async () => 2),
    cost: { balance: async () => 0, shortfall: async () => ({ required: 1 }) },
    ...over,
  };
}

function trading(tradeChain = chain(), h = harness()) {
  const refresh = {
    funding: vi.fn(async () => 0),
    portfolioAsset: vi.fn(async () => 0),
    portfolioCash: vi.fn(async () => true),
  };
  const deps = { ...h.deps, chain: tradeChain, refresh };
  return {
    h,
    deps,
    refresh,
    chain: tradeChain,
    place: (reviewed = plan(), relayerFeeRaw?: bigint) =>
      placeTrade(deps, {
        portfolioId: "p1",
        reviewed,
        network: relayerFeeRaw === undefined ? undefined : { relayerFeeRaw },
      }),
  };
}

describe("quoting a trade", () => {
  const quote = (t = trading(), symbol = "SPYx", amount = 20) =>
    quoteTrade(t.deps, { portfolioId: "p1", side: "buy", symbol, amount });

  it("prices it against the market price the site holds", async () => {
    const t = trading();
    expect(await quote(t)).toEqual({ kind: "quoted", plan: plan() });
    expect(t.chain.plan).toHaveBeenCalledWith(
      expect.objectContaining({ side: "buy", symbol: "SPYx", amount: 20, marketPrice: 10 }),
    );
    expect(t.h.track).toHaveBeenCalledWith("trade_quoted", { side: "buy" });
  });

  it("refuses off mainnet, an asset that is not a tracker, and a bad amount", async () => {
    expect(await quote(trading(chain({ available: () => false })))).toMatchObject({
      reason: "tradingMainnetOnly",
    });
    expect(await quote(trading(), "SOL")).toMatchObject({ reason: "notTradable", symbol: "SOL" });
    expect(await quote(trading(), "SPYx", -1)).toMatchObject({ reason: "activePortfolioAmount" });
  });

  it("shows a price with no order behind it for a portfolio that cannot pay the network yet", async () => {
    const priced = plan({ built: false });
    const plans = vi
      .fn()
      .mockRejectedValueOnce(new ChainError("noQuote"))
      .mockResolvedValueOnce(priced);
    const t = trading(chain({ plan: plans }));
    expect(await quote(t)).toEqual({ kind: "quoted", plan: priced });
    expect(plans).toHaveBeenLastCalledWith(expect.objectContaining({ priceOnly: true }));
  });

  it("counts a quote that failed, in the venue's words", async () => {
    const t = trading(
      chain({ plan: vi.fn(async () => Promise.reject(new ChainError("noQuote"))) }),
    );
    await t.h.store.update((wallet) => ({
      ...wallet,
      portfolios: wallet.portfolios.map((entry) =>
        entry.id === "p1"
          ? { ...entry, holdings: [{ symbol: "SOL", amount: 1, cost: 100 }] }
          : entry,
      ),
    }));
    const result = await quote(t);
    expect(result).toMatchObject({ kind: "failed", reason: "noPrice", cause: "noQuote" });
    expect(actionFailure(result as never)?.error).toBe(
      "There is no price for this order right now. Nothing was traded. Try again in a moment.",
    );
    expect(t.h.track).toHaveBeenCalledWith("trade_quote_failed", { side: "buy", reason: "other" });
  });
});

describe("placing a trade", () => {
  it("places the order it was shown, moves the cost basis by the cash that left, and logs it", async () => {
    const t = trading();
    expect(await t.place()).toEqual({
      kind: "confirmed",
      signature: "trade-sig",
      settlement: "balancesRead",
    });
    expect(t.chain.execute).toHaveBeenCalledWith(
      expect.objectContaining({ address: "Portfolio111" }),
      plan(),
      expect.any(Function),
    );
    expect(t.h.holding("p1", "SPYx")).toMatchObject({ amount: 2, cost: 20 });
    expect(t.h.holding("p1", "USDC")).toMatchObject({ amount: 30 });
    expect(t.h.wallet().activity[0]).toMatchObject({
      kind: "buy",
      symbol: "SPYx",
      amount: 2,
      usd: 20,
    });
    expect(t.h.track).toHaveBeenCalledWith("trade_placed", { side: "buy" });
    expect(t.h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("says when the balances could not be read back, standing in the quote's figures", async () => {
    const t = trading(
      chain({
        tradeBalances: vi.fn(async () => Promise.reject(new Error("rate limited"))),
        balanceOf: vi.fn(async () => Promise.reject(new Error("rate limited"))),
      }),
    );
    expect(await t.place()).toMatchObject({ kind: "confirmed", settlement: "balancesEstimated" });
    expect(t.h.holding("p1", "SPYx")).toMatchObject({ amount: 2 });
    expect(t.h.holding("p1", "USDC")).toMatchObject({ amount: 30 });
  });

  it("refuses an archived portfolio and a second confirm while the first is unsettled", async () => {
    const t = trading();
    expect(await placeTrade(t.deps, { portfolioId: "p2", reviewed: plan() })).toMatchObject({
      reason: "portfolioInactive",
    });
    await t.h.occupy();
    expect(await t.place()).toMatchObject({ reason: "actionPending" });
    expect(t.chain.execute).not.toHaveBeenCalled();
  });

  it("opens the account first on the relayer, keeping out the funding wallet and every other portfolio", async () => {
    const t = trading(chain({ isBuilt: () => false, plan: vi.fn(async () => plan()) }));
    expect(await t.place(plan({ built: false }), 2_000_000n)).toMatchObject({ kind: "confirmed" });
    expect(t.chain.openHolding).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewedFeeRaw: 2_000_000n,
        keepOut: [FUNDING_ADDRESS, OTHER_ADDRESS],
      }),
    );
    expect(t.refresh.portfolioCash).toHaveBeenCalledWith("p1", "Portfolio111");
  });

  it("does not place a re-priced order that is worse, says the cost is paid, and offers the new price", async () => {
    const worse = plan({ spend: 21 });
    const t = trading(chain({ isBuilt: () => false, plan: vi.fn(async () => worse) }));
    const result = await t.place(plan({ built: false }), 2_000_000n);
    expect(result).toEqual({
      kind: "needsReview",
      change: { because: "priceMoved", replacement: worse },
      completed: [{ step: "accountOpened", opens: "holding", signature: "open-sig" }],
    });
    expect(actionFailure(result)).toEqual({
      error:
        "The price moved while the account was being opened, so the order was not placed. Review the new price. The network cost is already paid.",
      replacement: worse,
      costCovered: true,
    });
    expect(t.chain.execute).not.toHaveBeenCalled();
    expect(t.h.track).not.toHaveBeenCalledWith("trade_failed", expect.anything());
  });

  it("says the cost is paid when the order fails after its account opened", async () => {
    const t = trading(
      chain({
        execute: vi.fn(async () => Promise.reject(new Error("The swap did not go through."))),
      }),
    );
    const result = await t.place(plan(), 2_000_000n);
    expect(result).toMatchObject({
      kind: "failed",
      reason: "orderNotPlaced",
      detail: "The swap did not go through.",
    });
    expect(actionFailure(result)).toEqual({
      error:
        "The swap did not go through. The network cost is already paid, so you can try again at no further cost.",
      costCovered: true,
    });
    expect(t.h.track).toHaveBeenCalledWith("trade_failed", { side: "buy", reason: "network" });
  });

  it("does not claim the cost is paid when the wallet locked before the order was signed", async () => {
    const t = trading(
      chain({ execute: vi.fn(async () => Promise.reject(new ChainError("walletLocked"))) }),
    );
    const result = await t.place(plan(), 2_000_000n);
    expect(result).toMatchObject({ kind: "failed", reason: "tradeFailed", cause: "walletLocked" });
    expect(actionFailure(result)).toEqual({
      error: "This wallet is locked. Unlock it with your password to sign.",
    });
  });

  it("asks for the new network cost when the relayer's fee rose while opening the account", async () => {
    const t = trading(
      chain({ openHolding: vi.fn(async () => Promise.reject(new ChainError("networkCostRose"))) }),
    );
    const result = await t.place(plan(), 2_000_000n);
    expect(actionFailure(result)).toEqual({
      error:
        "The network cost rose before this could be sent. Nothing was sent. Review the new network cost.",
      reviewAgain: "relayer",
    });
    expect(t.h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("keeps an unknown order pending, re-reads both balances, and reports no failure", async () => {
    const t = trading(
      chain({
        execute: vi.fn(async () => Promise.reject(new UnknownOutcomeError(undefined, 800))),
      }),
    );
    expect(await t.place()).toEqual({ kind: "unknown", lastValidBlockHeight: 800, completed: [] });
    expect(t.refresh.portfolioAsset).toHaveBeenCalledTimes(2);
    expect(t.h.pending.pendingFor("p1")).toMatchObject({
      status: "unknown",
      lastValidBlockHeight: 800,
    });
    expect(t.h.track).not.toHaveBeenCalledWith("trade_failed", expect.anything());
    expect(await t.place()).toMatchObject({ reason: "actionPending" });
  });
});

describe("reviewing the network cost of orders", () => {
  const review = (t: ReturnType<typeof trading>, plans: Plan[], withoutRelayer = false) =>
    reviewOrdersCost(t.deps, { portfolioId: "p1", plans, lamportsNeeded: 5_000, withoutRelayer });

  it("has the relayer open the account for a first buy the venue will not build yet", async () => {
    const t = trading(chain({ holdingOpen: vi.fn(async () => false) }));
    expect(await review(t, [plan({ built: false }, { gasless: false })])).toMatchObject({
      kind: "relayer",
      opens: "holding",
      count: 1,
    });
  });

  it("says an order under the venue's size is too small", async () => {
    const t = trading();
    expect(await review(t, [plan({ spend: 5, built: false }, { gasless: false })])).toEqual({
      kind: "tooSmall",
      smallest: 12,
    });
  });

  it("costs nothing when nothing is taken from the portfolio's own SOL", async () => {
    expect(
      await reviewOrdersCost(trading().deps, {
        portfolioId: "p1",
        plans: [plan()],
        lamportsNeeded: 0,
        withoutRelayer: false,
      }),
    ).toEqual({ kind: "covered" });
  });

  it("says there is no price when no way of paying applies and the order is not too small", async () => {
    expect(await review(trading(), [plan()], true)).toEqual({ kind: "noPrice" });
  });
});

describe("a trade and rewards", () => {
  /** The trade wired to claim itself, against a rewards server whose answer to a claim never comes. */
  function wired(h = harness()) {
    const t = trading(chain(), h);
    const claim = vi.fn(() => new Promise<never>(() => undefined));
    const api = { claim } as unknown as RewardsApi<FakeSigner>;
    const rewards = { session: h.deps.session, store: h.store, api };
    const deps = {
      ...t.deps,
      tradeLanded: (signature: string, portfolio: { derivationIndex: number }) =>
        void claimTrade(rewards, signature, portfolio),
    };
    return { t, claim, place: () => placeTrade(deps, { portfolioId: "p1", reviewed: plan() }) };
  }

  it("answers the same, without waiting, while the claim it started is never answered", async () => {
    const plain = await trading().place();
    const { t, claim, place } = wired(harness(wallet({ rewardsJoined: true })));
    expect(await place()).toEqual(plain);
    await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ transaction: "trade-sig" }));
    expect(t.h.wallet().rewardClaims).toEqual([{ signature: "trade-sig", derivationIndex: 1 }]);
  });

  it("answers the same when what hears of it throws", async () => {
    const t = trading();
    const tradeLanded = vi.fn(() => {
      throw new Error("rewards broke");
    });
    expect(
      await placeTrade({ ...t.deps, tradeLanded }, { portfolioId: "p1", reviewed: plan() }),
    ).toEqual({ kind: "confirmed", signature: "trade-sig", settlement: "balancesRead" });
    expect(tradeLanded).toHaveBeenCalledTimes(1);
  });

  it("claims nothing for a wallet that has not joined, and nothing for a trade that did not land", async () => {
    const off = wired();
    await off.place();
    expect(off.claim).not.toHaveBeenCalled();
    expect(off.t.h.wallet()).not.toHaveProperty("rewardClaims");

    const failing = trading(chain({ execute: vi.fn(async () => Promise.reject(new Error("no"))) }));
    const tradeLanded = vi.fn();
    await placeTrade({ ...failing.deps, tradeLanded }, { portfolioId: "p1", reviewed: plan() });
    expect(tradeLanded).not.toHaveBeenCalled();
  });
});
