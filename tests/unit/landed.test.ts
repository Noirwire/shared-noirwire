import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earn, type EarnChain } from "../../src/application/actions/earn.js";
import { fundDirectly, type AssetMoves } from "../../src/application/actions/fundDirectly.js";
import { fundPrivately, type PrivateToken } from "../../src/application/actions/fundPrivately.js";
import { openHoldings, runLegs } from "../../src/application/actions/pieOrder.js";
import { send, type SendableAsset, type SendChain } from "../../src/application/actions/send.js";
import {
  placeTrade,
  type TradeChain,
  type TradeOrder,
} from "../../src/application/actions/trade.js";
import { balancesUnread } from "../../src/application/result.js";
import { UnknownOutcomeError } from "../../src/domain/chainError.js";
import { actionFailure } from "../../src/presentation/actionResult.js";
import { earnResultView } from "../../src/presentation/earn.js";
import { fundingOutcomeView } from "../../src/presentation/funding.js";
import { sendResultView } from "../../src/presentation/send.js";
import { harness, RECIPIENT, type FakeSigner, type Harness } from "./support/actions.js";

/**
 * Once the chain or the venue has confirmed an action, its result is a
 * success whatever the reads after it do: a false failure on a payment that
 * went through invites paying again. And nothing that submits is ever tried
 * twice. Each action is held to both here.
 */

const dropped = () => new TypeError("fetch failed");
const unreadable = vi.fn(async (): Promise<number> => Promise.reject(dropped()));

/** Runs `work` to its end with every pause skipped. */
async function settled<T>(work: Promise<T>): Promise<T> {
  const outcome = work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}

/** A balance that reads `first` once, before the action, and cannot be read after it. */
const readOnceThenNot = (first: number) =>
  vi.fn(async (): Promise<number> => Promise.reject(dropped())).mockResolvedValueOnce(first);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function sendChain(asset: Partial<SendableAsset<FakeSigner>>) {
  const chain: SendChain<FakeSigner> = {
    asset: (symbol) => ({
      symbol,
      balance: async () => 50,
      ensureAccount: async () => undefined,
      deposit: async () => undefined,
      withdraw: async () => undefined,
      sendRelayed: vi.fn(async () => "relayed-sig"),
      ...asset,
    }),
    token: () => undefined,
    isRecipientAddress: () => true,
    cashSymbol: "USDC",
    networkFeeSol: 0.000005,
    cost: { balance: async () => 0, shortfall: async () => null },
  };
  return chain;
}

const sendInput = {
  portfolioId: "p1",
  send: { symbol: "USDC", amount: 10, to: RECIPIENT },
  network: { relayerFeeRaw: 20_000n },
};

describe("a send", () => {
  it("is sent when it landed and its new balance cannot be read, with the flag for the screen", async () => {
    const h = harness();
    const balance = readOnceThenNot(50);
    const result = await settled(send({ ...h.deps, chain: sendChain({ balance }) }, sendInput));
    expect(result).toEqual({
      kind: "confirmed",
      signature: "relayed-sig",
      settlement: "balancesEstimated",
    });
    expect(balancesUnread(result)).toBe(true);
    expect(actionFailure(result)).toBeNull();
    // Read once before, then asked for three times after landing.
    expect(balance).toHaveBeenCalledTimes(4);
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 40 });
    expect(h.wallet().activity[0]).toMatchObject({ kind: "send", amount: 10 });
    expect(h.track).toHaveBeenCalledWith("sent");
    expect(h.track).not.toHaveBeenCalledWith("send_failed", expect.anything());
    expect(h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("reads the balance back on a later try and then says so", async () => {
    const h = harness();
    const balance = vi
      .fn(async () => 40)
      .mockResolvedValueOnce(50)
      .mockRejectedValueOnce(dropped());
    const result = await settled(send({ ...h.deps, chain: sendChain({ balance }) }, sendInput));
    expect(result).toMatchObject({ kind: "confirmed", settlement: "balancesRead" });
    expect(balancesUnread(result)).toBe(false);
  });

  it("stays unknown when its outcome is unknown, whatever is read after", async () => {
    const h = harness();
    const sendRelayed = vi.fn(async () => Promise.reject(new UnknownOutcomeError("sig", 10)));
    const result = await settled(
      send(
        { ...h.deps, chain: sendChain({ balance: readOnceThenNot(50), sendRelayed }) },
        sendInput,
      ),
    );
    expect(result).toMatchObject({ kind: "unknown", signature: "sig" });
    expect(sendRelayed).toHaveBeenCalledTimes(1);
  });

  it("says nothing was sent when it failed before anything was", async () => {
    const h = harness();
    const sendRelayed = vi.fn(async () => Promise.reject(new Error("Simulation refused.")));
    const failed = await settled(send({ ...h.deps, chain: sendChain({ sendRelayed }) }, sendInput));
    expect(failed).toMatchObject({ kind: "failed", reason: "sendFailed" });
    expect(sendRelayed).toHaveBeenCalledTimes(1);

    const unread = await settled(
      send({ ...h.deps, chain: sendChain({ balance: unreadable }) }, sendInput),
    );
    expect(actionFailure(unread)?.error).toBe(
      "We couldn't complete this send. Nothing was sent. Try again.",
    );
  });

  it("says it was sent, and that balances will follow", () => {
    expect(sendResultView("landed", "10.00 USDC", "Main", true)).toEqual({
      title: "Sent 10.00 USDC",
      body: "To the address you entered. It has left Main. Balances will update shortly.",
      close: "Done",
    });
    expect(sendResultView("landed", "10.00 USDC", "Main").body).toBe(
      "To the address you entered. It has left Main.",
    );
  });
});

function funding(h: Harness, asset: Partial<AssetMoves<FakeSigner>>) {
  const moves: AssetMoves<FakeSigner> = {
    symbol: "USDC",
    balance: async () => 60,
    ensureAccount: vi.fn(async () => undefined),
    deposit: vi.fn(async () => undefined),
    withdraw: async () => undefined,
    ...asset,
  };
  const refresh = {
    funding: vi.fn(async () => Promise.reject(dropped())),
    portfolioAsset: vi.fn(async () => 0),
    portfolioCash: vi.fn(async () => true),
  };
  return {
    moves,
    run: () =>
      settled(
        fundDirectly(
          { ...h.deps, asset: () => moves, refresh },
          { portfolioId: "p1", amount: 10, symbol: "USDC" },
        ),
      ),
  };
}

describe("moving money in publicly", () => {
  it("is done when the deposit landed and nothing can be read after it", async () => {
    const h = harness();
    const t = funding(h, { balance: unreadable });
    const result = await t.run();
    expect(result).toEqual({ kind: "confirmed", settlement: "balancesEstimated" });
    expect(balancesUnread(result)).toBe(true);
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 60 });
    expect(h.wallet().activity[0]).toMatchObject({ kind: "fund", amount: 10 });
    expect(h.track).toHaveBeenCalledWith("funded_directly");
    expect(h.pending.pendingFor(h.FUNDING)).toBeUndefined();
  });

  it("does not deposit twice when the deposit failed on the way out", async () => {
    const h = harness();
    const deposit = vi.fn(async () => Promise.reject(dropped()));
    const t = funding(h, { deposit });
    const result = await t.run();
    expect(result).toMatchObject({ kind: "failed", reason: "fundingFailed" });
    expect(actionFailure(result)?.error).toBe(
      "We couldn't move this money. Nothing was moved. Try again.",
    );
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(t.moves.ensureAccount).toHaveBeenCalledTimes(1);
  });

  it("says the money moved, and that the balance will follow", () => {
    expect(
      fundingOutcomeView({
        outcome: "done",
        asset: "USDC",
        privateRoute: false,
        amount: 10,
        arrived: 0,
        fee: 0,
        portfolioLabel: "Main",
        balancesUnread: true,
      }),
    ).toMatchObject({
      title: "Funds arrived",
      body: "10.00 USDC was moved into Main. Its balance will update shortly.",
      tone: "success",
    });
  });
});

function privately(h: Harness, token: Partial<PrivateToken<FakeSigner>> = {}) {
  const privateToken: PrivateToken<FakeSigner> = {
    symbol: "USDC",
    balance: async () => 50,
    sendPrivately: vi.fn(async () => ({ signature: "private-sig", feeTokens: 0.21 })),
    nudgeSettlement: async () => undefined,
    ...token,
  };
  const refresh = { funding: vi.fn(async () => Promise.reject(dropped())) };
  return {
    privateToken,
    run: () =>
      settled(
        fundPrivately(
          { ...h.deps, privateToken: () => privateToken, refresh },
          { portfolioId: "p1", amount: 10, symbol: "USDC" },
        ),
      ),
  };
}

describe("moving money in privately", () => {
  it("is accepted once the service took it, even when that cannot be written down or re-read", async () => {
    const h = harness();
    const reserve = h.deps.pending.reserve;
    const deps = {
      ...h.deps,
      pending: {
        reserve: async (...args: Parameters<typeof reserve>) => {
          const reservation = await reserve(...args);
          return (
            reservation && {
              ...reservation,
              submitted: async () => Promise.reject(new Error("storage is full")),
            }
          );
        },
      },
    };
    const t = privately(h);
    const result = await settled(
      fundPrivately(
        { ...deps, privateToken: () => t.privateToken, refresh: { funding: unreadable } },
        { portfolioId: "p1", amount: 10, symbol: "USDC" },
      ),
    );
    expect(result).toEqual({
      kind: "submitted",
      signature: "private-sig",
      feeTokens: 0.21,
      balanceBefore: 50,
    });
    expect(h.track).toHaveBeenCalledWith("private_funding_started");
    expect(h.track).not.toHaveBeenCalledWith("funding_failed", expect.anything());
  });

  it("does not hand the transfer over twice when it failed on the way out", async () => {
    const h = harness();
    const sendPrivately = vi.fn(async () => Promise.reject(dropped()));
    const result = await privately(h, { sendPrivately }).run();
    expect(result).toMatchObject({ kind: "failed", reason: "privateNotStarted" });
    expect(sendPrivately).toHaveBeenCalledTimes(1);
    expect(h.pending.pendingFor(h.FUNDING)).toBeUndefined();
  });

  it("stays unknown when the service never answered", async () => {
    const h = harness();
    const sendPrivately = vi.fn(async () => Promise.reject(new UnknownOutcomeError()));
    expect(await privately(h, { sendPrivately }).run()).toMatchObject({ kind: "unknown" });
    expect(sendPrivately).toHaveBeenCalledTimes(1);
  });
});

function lending(h: Harness, over: Partial<EarnChain<FakeSigner>> = {}) {
  const chain: EarnChain<FakeSigner> = {
    available: () => true,
    move: vi.fn(async () => "lend-sig"),
    moveRelayed: vi.fn(async () => "relayed-sig"),
    quoteRelayed: async () => ({ feeRaw: 30_000n, opensAccount: true }),
    cashSymbol: "USDC",
    cost: { balance: async () => 0, shortfall: async () => null },
    ...over,
  };
  return chain;
}

describe.each(["deposit", "withdraw"] as const)("an Earn %s", (action) => {
  const input = { portfolioId: "p1", action, amount: 10, network: { relayerFeeRaw: 30_000n } };

  it("is done when it landed and the balances cannot be read, by a throw or by a failed read", async () => {
    for (const portfolioCash of [async () => Promise.reject(dropped()), async () => false]) {
      const h = harness();
      const result = await settled(
        earn({ ...h.deps, chain: lending(h), refresh: { portfolioCash } }, input),
      );
      expect(result).toEqual({
        kind: "confirmed",
        signature: "relayed-sig",
        settlement: "balancesEstimated",
      });
      expect(h.wallet().activity[0]).toMatchObject({
        kind: action === "deposit" ? "earnDeposit" : "earnWithdraw",
      });
      expect(h.track).toHaveBeenCalledWith(`earn_${action}`);
      expect(h.track).not.toHaveBeenCalledWith("earn_failed", expect.anything());
      expect(h.pending.pendingFor("p1")).toBeUndefined();
    }
  });

  it("is not made twice when it failed on the way out, and answers even if nothing can be re-read", async () => {
    const h = harness();
    const moveRelayed = vi.fn(async () => Promise.reject(dropped()));
    const result = await settled(
      earn(
        {
          ...h.deps,
          chain: lending(h, { moveRelayed }),
          refresh: { portfolioCash: async () => Promise.reject(dropped()) },
        },
        input,
      ),
    );
    expect(result).toMatchObject({ kind: "failed", reason: "earnFailed" });
    expect(actionFailure(result)?.error).toBe(
      "This did not go through. Nothing was moved. Try again.",
    );
    expect(moveRelayed).toHaveBeenCalledTimes(1);
  });

  it("says it was done, and that balances will follow", () => {
    expect(
      earnResultView({
        action,
        outcome: "landed",
        amount: 10,
        fee: 0,
        portfolioLabel: "Main",
        balancesUnread: true,
      }).body,
    ).toMatch(/ Balances will update shortly\.$/);
  });
});

type Plan = TradeOrder & { built: boolean };

const priced: Plan = {
  side: "buy",
  stock: { symbol: "SPYx" },
  spend: 20,
  receive: 2,
  receiveAtLeast: 1.9,
  unitPrice: 10,
  venue: "Jupiter",
  priceChecked: true,
  built: true,
  quote: { feeBps: 50, gasless: true },
};

function trading(over: Partial<TradeChain<FakeSigner, Plan>> = {}) {
  const h = harness();
  const chain: TradeChain<FakeSigner, Plan> = {
    available: () => true,
    isStock: (symbol) => symbol === "SPYx",
    plan: vi.fn(async () => priced),
    isBuilt: (entry) => entry.built,
    execute: vi.fn(async () => "trade-sig"),
    gaslessFromUsd: 12,
    cashSymbol: "USDC",
    holdingOpen: async () => true,
    quoteOpenHolding: async () => ({ feeRaw: 2_000_000n, opensAccount: true }),
    openHolding: vi.fn(async () => "open-sig"),
    tradeBalances: async () => Promise.reject(dropped()),
    balanceOf: async () => Promise.reject(dropped()),
    cost: { balance: async () => 0, shortfall: async () => null },
    ...over,
  };
  const refresh = {
    funding: async () => Promise.reject(dropped()),
    portfolioAsset: async () => Promise.reject(dropped()),
    portfolioCash: async () => Promise.reject(dropped()),
  };
  return { h, chain, deps: { ...h.deps, chain, refresh } };
}

describe("an order", () => {
  it("is placed when it landed and no balance can be read after it", async () => {
    const t = trading();
    const result = await settled(placeTrade(t.deps, { portfolioId: "p1", reviewed: priced }));
    expect(result).toEqual({
      kind: "confirmed",
      signature: "trade-sig",
      settlement: "balancesEstimated",
    });
    expect(t.h.holding("p1", "SPYx")).toMatchObject({ amount: 2 });
    expect(t.h.holding("p1", "USDC")).toMatchObject({ amount: 30 });
    expect(t.h.track).toHaveBeenCalledWith("trade_placed", { side: "buy" });
    expect(t.chain.execute).toHaveBeenCalledTimes(1);
  });

  it("is placed after its account was opened, even when the balances between the two cannot be read", async () => {
    const t = trading();
    const result = await settled(
      placeTrade(t.deps, {
        portfolioId: "p1",
        reviewed: priced,
        network: { relayerFeeRaw: 2_000_000n },
      }),
    );
    expect(result).toMatchObject({ kind: "confirmed", settlement: "balancesEstimated" });
    expect(t.chain.openHolding).toHaveBeenCalledTimes(1);
    expect(t.chain.execute).toHaveBeenCalledTimes(1);
  });

  it("is not placed twice when it failed on the way out", async () => {
    const execute = vi.fn(async () => Promise.reject(dropped()));
    const t = trading({ execute });
    expect(
      await settled(placeTrade(t.deps, { portfolioId: "p1", reviewed: priced })),
    ).toMatchObject({ kind: "failed", reason: "tradeFailed" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("a pie's orders", () => {
  const legs = ["SPYx", "QQQx"].map((symbol) => ({ symbol, plan: priced }));
  const run = (submit: () => Promise<{ ok: true; unconfirmed?: boolean } | { error: string }>) =>
    runLegs(legs, {
      now: () => 0,
      requote: async () => ({ plan: priced }),
      approve: async () => true,
      submit,
      onChange: () => undefined,
    });

  it("counts an order that landed unread as placed, and places nothing after it", async () => {
    const submit = vi.fn(async () => ({ ok: true as const, unconfirmed: true }));
    expect(await run(submit)).toEqual([
      { symbol: "SPYx", status: "done", unread: true },
      { symbol: "QQQx", status: "not placed" },
    ]);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("submits an order that failed once, and stops", async () => {
    const submit = vi.fn(async () => Promise.reject(dropped()));
    expect((await run(submit)).map((leg) => leg.status)).toEqual(["failed", "not placed"]);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe("opening a pie's holdings", () => {
  const opening = (h: Harness, openHolding: () => Promise<string | null>, readable: boolean) =>
    settled(
      openHoldings(
        {
          ...h.deps,
          chain: { stock: (symbol) => ({ symbol }), openHolding },
          refresh: {
            portfolioCash: async () => (readable ? true : Promise.reject(dropped())),
          },
        },
        { portfolioId: "p1", symbols: ["SPYx", "QQQx"], reviewedFeeRaw: 2_000_000n },
      ),
    );

  it("is done when every account opened and the balances cannot be read", async () => {
    const h = harness();
    const openHolding = vi.fn(async () => "open-sig");
    expect(await opening(h, openHolding, false)).toEqual({
      kind: "confirmed",
      settlement: "balancesEstimated",
    });
    expect(openHolding).toHaveBeenCalledTimes(2);
    expect(h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("does not open an account twice when opening failed on the way out, and keeps what was opened", async () => {
    const h = harness();
    const openHolding = vi
      .fn(async (): Promise<string | null> => Promise.reject(dropped()))
      .mockResolvedValueOnce("open-sig");
    const result = await opening(h, openHolding, false);
    expect(result).toMatchObject({
      kind: "failed",
      reason: "holdingsNotOpened",
      completed: [{ step: "accountOpened", opens: "holding", signature: "open-sig" }],
    });
    expect(openHolding).toHaveBeenCalledTimes(2);
  });
});

describe("a reservation that cannot be ended", () => {
  it("does not turn a landed send into a failure", async () => {
    const h = harness();
    const reserve = h.deps.pending.reserve;
    const deps = {
      ...h.deps,
      pending: {
        reserve: async (...args: Parameters<typeof reserve>) => {
          const reservation = await reserve(...args);
          return (
            reservation && {
              ...reservation,
              finish: async () => Promise.reject(new Error("storage is full")),
            }
          );
        },
      },
    };
    const result = await settled(send({ ...deps, chain: sendChain({}) }, sendInput));
    expect(result).toMatchObject({ kind: "confirmed", settlement: "balancesRead" });
  });
});
