import { afterEach, describe, expect, it, vi } from "vitest";
import { fundDirectly, type AssetMoves } from "../../../src/application/actions/fundDirectly.js";
import {
  awaitPrivateArrival,
  fundPrivately,
  type PrivateToken,
} from "../../../src/application/actions/fundPrivately.js";
import { ChainError, UnknownOutcomeError } from "../../../src/domain/chainError.js";
import { actionFailure } from "../../../src/presentation/actionResult.js";
import {
  FUNDING_ADDRESS,
  harness,
  OTHER_ADDRESS,
  OWN_ADDRESS,
  portfolio,
  wallet,
  type FakeSigner,
} from "../support/actions.js";

function usdc(over: Partial<AssetMoves<FakeSigner>> = {}): AssetMoves<FakeSigner> {
  return {
    symbol: "USDC",
    balance: vi.fn(async () => 75),
    ensureAccount: vi.fn(async () => undefined),
    deposit: vi.fn(async () => undefined),
    withdraw: vi.fn(async () => undefined),
    ...over,
  };
}

function direct(h = harness(), asset = usdc()) {
  const refresh = {
    funding: vi.fn(async () => 0),
    portfolioAsset: vi.fn(async () => 0),
    portfolioCash: vi.fn(async () => true),
  };
  const deps = {
    ...h.deps,
    asset: (symbol: string) => (symbol === asset.symbol ? asset : undefined),
    refresh,
  };
  return {
    h,
    asset,
    refresh,
    run: (amount = 25, symbol = "USDC") =>
      fundDirectly(deps, { portfolioId: "p1", amount, symbol }),
  };
}

describe("funding a portfolio directly", () => {
  it("signs with both keys, records the balance the chain shows, and releases the reservation", async () => {
    const { h, asset, refresh, run } = direct();
    expect(await run()).toEqual({ kind: "confirmed", settlement: "balancesRead" });
    expect(asset.deposit).toHaveBeenCalledWith(
      expect.objectContaining({ address: FUNDING_ADDRESS }),
      expect.objectContaining({ address: OWN_ADDRESS }),
      25,
      expect.any(Function),
    );
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 75, cost: 75 });
    expect(h.wallet().activity[0]).toMatchObject({
      kind: "fund",
      symbol: "USDC",
      amount: 25,
      usd: 25,
    });
    expect(refresh.funding).toHaveBeenCalledWith(FUNDING_ADDRESS, "USDC");
    expect(h.track).toHaveBeenCalledWith("funded_directly");
    expect(h.pending.pendingFor(h.FUNDING)).toBeUndefined();
  });

  it("refuses, with nothing signed, a locked wallet, a bad amount, an archived portfolio, an unknown asset and a key that does not match", async () => {
    const locked = direct();
    locked.h.lock();
    expect(await locked.run()).toMatchObject({ kind: "refused", reason: "walletLocked" });

    const { run, asset, h } = direct();
    expect(await run(0)).toMatchObject({ kind: "refused", reason: "activePortfolioAmount" });
    expect(
      await fundDirectly(
        { ...h.deps, asset: () => asset, refresh: direct().refresh },
        {
          portfolioId: "p2",
          amount: 5,
          symbol: "USDC",
        },
      ),
    ).toMatchObject({ kind: "refused", reason: "activePortfolioAmount" });
    expect(await run(5, "DOGE")).toEqual({
      kind: "refused",
      reason: "unknownAsset",
      symbol: "DOGE",
      completed: [],
    });
    h.mismatchKeys();
    expect(await run()).toMatchObject({ kind: "refused", reason: "keyMismatch" });
    expect(asset.deposit).not.toHaveBeenCalled();
  });

  it("refuses a second move of money while the funding wallet's last one is unsettled", async () => {
    const { h, asset, run } = direct();
    await h.occupy(h.FUNDING, FUNDING_ADDRESS);
    expect(await run()).toMatchObject({ kind: "refused", reason: "actionPending" });
    expect(asset.deposit).not.toHaveBeenCalled();
  });

  it("counts a failure by its words and releases the reservation", async () => {
    const { h, run } = direct(
      harness(),
      usdc({ deposit: vi.fn(async () => Promise.reject(new Error("Transfer blew up."))) }),
    );
    const result = await run();
    expect(result).toEqual({
      kind: "failed",
      reason: "fundingFailed",
      detail: "Transfer blew up.",
      completed: [],
    });
    expect(h.track).toHaveBeenCalledWith("funding_failed", { route: "direct", reason: "other" });
    expect(h.pending.pendingFor(h.FUNDING)).toBeUndefined();
  });

  it("says the wallet locked, in the words it always has, when it locks before signing", async () => {
    const { h, run } = direct(
      harness(),
      usdc({ deposit: vi.fn(async () => Promise.reject(new ChainError("walletLocked"))) }),
    );
    const result = await run();
    expect(result).toMatchObject({ kind: "failed", cause: "walletLocked" });
    expect(actionFailure(result)?.error).toBe(
      "This wallet is locked. Unlock it with your password to sign.",
    );
    expect(h.track).toHaveBeenCalledWith("funding_failed", { route: "direct", reason: "locked" });
  });

  it("keeps an unknown outcome pending, re-reads both balances, and refuses the same move again", async () => {
    const { h, refresh, run } = direct(
      harness(),
      usdc({ deposit: vi.fn(async () => Promise.reject(new UnknownOutcomeError("sig", 900))) }),
    );
    expect(await run()).toEqual({
      kind: "unknown",
      signature: "sig",
      lastValidBlockHeight: 900,
      completed: [],
    });
    expect(refresh.portfolioAsset).toHaveBeenCalledWith("p1", OWN_ADDRESS, "USDC");
    expect(h.track).not.toHaveBeenCalledWith("funding_failed", expect.anything());
    expect(h.pending.pendingFor(h.FUNDING)).toMatchObject({ status: "unknown", signature: "sig" });
    expect(await run()).toMatchObject({ kind: "refused", reason: "actionPending" });
  });
});

function privateToken(over: Partial<PrivateToken<FakeSigner>> = {}): PrivateToken<FakeSigner> {
  return {
    symbol: "USDC",
    balance: vi.fn(async () => 10),
    sendPrivately: vi.fn(async () => ({ signature: "enqueue", feeTokens: 0.3 })),
    nudgeSettlement: vi.fn(async () => undefined),
    ...over,
  };
}

function privately(token = privateToken(), h = harness()) {
  const refresh = { funding: vi.fn(async () => 0), portfolioAsset: vi.fn(async () => 0) };
  const deps = {
    ...h.deps,
    privateToken: (symbol: string) => (symbol === token.symbol ? token : undefined),
    refresh,
  };
  return {
    h,
    token,
    deps,
    refresh,
    run: (amount = 20, symbol = "USDC", from = "funding", to = "p1") =>
      fundPrivately(deps, { from, to, amount, symbol }),
  };
}

const TRIPS_ADDRESS = "Portfolio333";

/** A wallet with a second portfolio that is still in use, beside the archived one. */
function twoActive() {
  return harness(
    wallet({
      portfolios: [
        ...wallet().portfolios,
        portfolio({ id: "p3", label: "Trips", address: TRIPS_ADDRESS, derivationIndex: 3 }),
      ],
    }),
  );
}

describe("moving money privately out of a portfolio", () => {
  afterEach(() => vi.useRealTimers());

  it("is signed by the portfolio, for the main wallet, naming no other place of the wallet", async () => {
    const { h, token, refresh, run } = privately(privateToken(), twoActive());
    expect(await run(20, "USDC", "p1", "funding")).toMatchObject({ kind: "submitted" });
    expect(token.sendPrivately).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: expect.objectContaining({ address: OWN_ADDRESS }),
        to: FUNDING_ADDRESS,
        keepOut: [FUNDING_ADDRESS, OTHER_ADDRESS, TRIPS_ADDRESS],
      }),
    );
    expect(h.pending.pendingFor("p1")).toMatchObject({
      signature: "enqueue",
      what: "a private move of 20.00 USDC into Main wallet",
    });
    expect(h.pending.pendingFor(h.FUNDING)).toBeUndefined();
    expect(refresh.portfolioAsset).toHaveBeenCalledWith("p1", OWN_ADDRESS, "USDC");
  });

  it("goes from one portfolio to another, and is listed as money out once its transaction has landed", async () => {
    const { h, token, run } = privately(privateToken(), twoActive());
    expect(await run(20, "USDC", "p1", "p3")).toMatchObject({ kind: "submitted" });
    expect(token.sendPrivately).toHaveBeenCalledWith(
      expect.objectContaining({
        to: TRIPS_ADDRESS,
        keepOut: [FUNDING_ADDRESS, OTHER_ADDRESS, TRIPS_ADDRESS],
      }),
    );
    expect(h.wallet().activity).toEqual([]);
    h.settle.mockResolvedValueOnce("landed" as never);
    await h.pending.settlePending("p1");
    expect(h.wallet().activity).toEqual([
      expect.objectContaining({
        portfolioId: "p1",
        kind: "send",
        amount: 20,
        counterparty: TRIPS_ADDRESS,
      }),
    ]);
  });

  it("refuses a move that would arrive where it left, or at an archived portfolio", async () => {
    const { token, run } = privately(privateToken(), twoActive());
    expect(await run(20, "USDC", "p1", "p1")).toMatchObject({ kind: "refused" });
    expect(await run(20, "USDC", "p1", "p2")).toMatchObject({ kind: "refused" });
    expect(await run(20, "USDC", "p2", "funding")).toMatchObject({ kind: "refused" });
    expect(token.sendPrivately).not.toHaveBeenCalled();
  });

  it("records an arrival in the main wallet as money that arrived there", async () => {
    vi.useFakeTimers();
    const { h, deps } = privately(privateToken({ balance: vi.fn().mockResolvedValue(120) }));
    const arrival = awaitPrivateArrival(deps, {
      from: "p1",
      to: "funding",
      symbol: "USDC",
      balanceBefore: 100,
      amount: 20,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await arrival).toBe(120);
    expect(h.wallet().funding.tokens.USDC).toBe(120);
    expect(h.wallet().activity).toEqual([
      expect.objectContaining({ portfolioId: "funding", kind: "deposit", amount: 20 }),
    ]);
  });

  it("records the whole arrival when a balance refresh stored a part of it without writing it down", async () => {
    vi.useFakeTimers();
    const h = harness(
      wallet({ funding: { address: FUNDING_ADDRESS, sol: 0, tokens: { USDC: 113.333333 } } }),
    );
    const { deps } = privately(privateToken({ balance: vi.fn().mockResolvedValue(120) }), h);
    const arrival = awaitPrivateArrival(deps, {
      from: "p1",
      to: "funding",
      symbol: "USDC",
      balanceBefore: 100,
      amount: 20,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await arrival).toBe(120);
    expect(h.wallet().activity).toEqual([
      expect.objectContaining({ portfolioId: "funding", kind: "deposit", amount: 20 }),
    ]);
  });

  it("does not record again the parts a balance refresh wrote down while it watched", async () => {
    vi.useFakeTimers();
    const balance = vi.fn().mockResolvedValueOnce(113.333333).mockResolvedValue(120);
    const { h, deps } = privately(privateToken({ balance }));
    const arrival = awaitPrivateArrival(deps, {
      from: "p1",
      to: "funding",
      symbol: "USDC",
      balanceBefore: 100,
      amount: 20,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await h.store.update((current) => ({
      ...current,
      activity: [
        {
          id: "seen",
          at: Date.now(),
          portfolioId: "funding",
          kind: "deposit",
          symbol: "USDC",
          amount: 13.333333,
          usd: 13.333333,
        },
      ],
    }));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await arrival).toBe(120);
    expect(h.wallet().activity).toHaveLength(2);
    expect(h.wallet().activity[0].amount).toBeCloseTo(6.666667, 6);
  });

  it("records money from another portfolio as arrived, never as a move out of the main wallet", async () => {
    vi.useFakeTimers();
    const { h, deps } = privately(
      privateToken({ balance: vi.fn().mockResolvedValue(70) }),
      twoActive(),
    );
    const arrival = awaitPrivateArrival(deps, {
      from: "p3",
      to: "p1",
      symbol: "USDC",
      balanceBefore: 50,
      amount: 20,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await arrival).toBe(70);
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 70 });
    expect(h.wallet().activity).toEqual([
      expect.objectContaining({ portfolioId: "p1", kind: "deposit", amount: 20 }),
    ]);
  });
});

describe("funding a portfolio privately", () => {
  afterEach(() => vi.useRealTimers());

  it("hands the transfer over naming no portfolio, and keeps the reservation until the chain shows it", async () => {
    const { h, token, run } = privately();
    expect(await run()).toEqual({
      kind: "submitted",
      signature: "enqueue",
      feeTokens: 0.3,
      balanceBefore: 10,
    });
    expect(token.sendPrivately).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OWN_ADDRESS,
        amount: 20,
        keepOut: [OWN_ADDRESS, "Portfolio222"],
      }),
    );
    expect(h.pending.pendingFor(h.FUNDING)).toMatchObject({
      signature: "enqueue",
      what: "a private move of 20.00 USDC into Main",
    });
    expect(await run()).toMatchObject({ kind: "refused", reason: "actionPending" });
    expect(h.track).toHaveBeenCalledWith("private_funding_started");
  });

  it("refuses an asset that cannot travel privately", async () => {
    const { run } = privately();
    expect(await run(20, "SOL")).toMatchObject({
      kind: "refused",
      reason: "notPrivate",
      symbol: "SOL",
    });
  });

  it("counts a transfer that could not be started and releases the reservation", async () => {
    const { h, run } = privately(
      privateToken({
        sendPrivately: vi.fn(async () => Promise.reject(new Error("refused by the queue"))),
      }),
    );
    expect(await run()).toMatchObject({
      kind: "failed",
      reason: "privateNotStarted",
      detail: "refused by the queue",
    });
    expect(h.track).toHaveBeenCalledWith("funding_failed", { route: "private", reason: "other" });
    expect(h.pending.pendingFor(h.FUNDING)).toBeUndefined();
  });

  it("answers one sent with no word on it as unknown, which the screen must not offer again", async () => {
    const { h, run } = privately(
      privateToken({ sendPrivately: vi.fn(async () => Promise.reject(new UnknownOutcomeError())) }),
    );
    const result = await run();
    expect(result).toEqual({ kind: "unknown", completed: [] });
    expect(h.pending.pendingFor(h.FUNDING)).toMatchObject({ status: "unknown" });
  });

  it("records the arrival once the balance moves past where it started", async () => {
    vi.useFakeTimers();
    const balance = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(29.7);
    const { h, deps } = privately(privateToken({ balance }));
    const arrival = awaitPrivateArrival(deps, {
      from: "funding",
      to: "p1",
      symbol: "USDC",
      balanceBefore: 10,
      amount: 19.7,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await arrival).toBe(29.7);
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 29.7 });
    expect(h.wallet().activity[0]).toMatchObject({ kind: "fund", amount: expect.closeTo(19.7, 6) });
    expect(h.track).toHaveBeenCalledWith("private_funding_arrived");
  });

  it("waits for every part of a transfer delivered in three, and records the whole of it once", async () => {
    vi.useFakeTimers();
    const balance = vi
      .fn()
      .mockResolvedValueOnce(13.333333)
      .mockResolvedValueOnce(16.666666)
      .mockResolvedValue(20);
    const { h, deps } = privately(privateToken({ balance }));
    let settled: number | null | undefined;
    const arrival = awaitPrivateArrival(deps, {
      from: "funding",
      to: "p1",
      symbol: "USDC",
      balanceBefore: 10,
      amount: 10,
    }).then((value) => (settled = value));
    await vi.advanceTimersByTimeAsync(6_000);
    // Two of three parts are there: not an arrival yet, and nothing is recorded.
    expect(settled).toBeUndefined();
    expect(h.wallet().activity).toEqual([]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await arrival).toBe(20);
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 20 });
    expect(h.wallet().activity).toHaveLength(1);
    expect(h.wallet().activity[0]).toMatchObject({ kind: "fund", amount: 10 });
  });

  it("records only what did arrive when the window ends with part of it still on its way", async () => {
    vi.useFakeTimers();
    const { h, deps } = privately(privateToken({ balance: vi.fn().mockResolvedValue(13.333333) }));
    const arrival = awaitPrivateArrival(deps, {
      from: "funding",
      to: "p1",
      symbol: "USDC",
      balanceBefore: 10,
      amount: 10,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await arrival).toBe(13.333333);
    expect(h.wallet().activity).toHaveLength(1);
    expect(h.wallet().activity[0].amount).toBeCloseTo(3.333333, 6);
    expect(h.track).not.toHaveBeenCalledWith("private_funding_still_pending");
  });

  it("calls it still pending, not failed, when nothing arrives in the window, nudging the queue once", async () => {
    vi.useFakeTimers();
    const token = privateToken();
    const { h, deps } = privately(token);
    const arrival = awaitPrivateArrival(deps, {
      from: "funding",
      to: "p1",
      symbol: "USDC",
      balanceBefore: 10,
      amount: 5,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await arrival).toBeNull();
    expect(token.nudgeSettlement).toHaveBeenCalledOnce();
    expect(h.track).toHaveBeenCalledWith("private_funding_still_pending");
  });
});
