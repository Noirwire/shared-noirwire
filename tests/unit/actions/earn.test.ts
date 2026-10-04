import { describe, expect, it, vi } from "vitest";
import { earn, reviewEarnCost, type EarnChain } from "../../../src/application/actions/earn.js";
import { ChainError, UnknownOutcomeError } from "../../../src/domain/chainError.js";
import { actionFailure } from "../../../src/presentation/actionResult.js";
import { FUNDING_ADDRESS, harness, OTHER_ADDRESS, type FakeSigner } from "../support/actions.js";

function chain(over: Partial<EarnChain<FakeSigner>> = {}): EarnChain<FakeSigner> {
  return {
    available: () => true,
    move: vi.fn(async () => "lend-sig"),
    moveRelayed: vi.fn(async () => "relayed-sig"),
    quoteRelayed: vi.fn(async () => ({ feeRaw: 30_000n, opensAccount: true })),
    cashSymbol: "USDC",
    cost: { balance: async () => 0, shortfall: async () => ({ required: 1 }) },
    ...over,
  };
}

function lending(earnChain = chain(), h = harness()) {
  const refresh = { portfolioCash: vi.fn(async () => true) };
  const deps = { ...h.deps, chain: earnChain, refresh };
  return {
    h,
    deps,
    refresh,
    run: (
      over: { portfolioId?: string; action?: "deposit" | "withdraw"; amount?: number } = {},
      relayerFeeRaw?: bigint,
    ) =>
      earn(deps, {
        portfolioId: over.portfolioId ?? "p1",
        action: over.action ?? "deposit",
        amount: over.amount ?? 10,
        network: relayerFeeRaw === undefined ? undefined : { relayerFeeRaw },
      }),
  };
}

describe("lending and withdrawing", () => {
  it("lends with the portfolio's own key, then re-reads what it holds", async () => {
    const t = lending();
    expect(await t.run()).toEqual({
      kind: "confirmed",
      signature: "lend-sig",
      settlement: "balancesRead",
    });
    expect(t.refresh.portfolioCash).toHaveBeenCalledWith("p1", "Portfolio111");
    expect(t.h.track).toHaveBeenCalledWith("earn_deposit");
  });

  it("records each move into Earn and back as its own kind of activity", async () => {
    const t = lending();
    await t.run({ action: "deposit", amount: 10 });
    await t.run({ action: "withdraw", amount: 4 });
    expect(t.h.wallet().activity).toMatchObject([
      { portfolioId: "p1", kind: "earnWithdraw", symbol: "USDC", amount: 4 },
      { portfolioId: "p1", kind: "earnDeposit", symbol: "USDC", amount: 10 },
    ]);
  });

  it("keeps the activity entry with the reservation, so a move that lands unseen is still recorded", async () => {
    const t = lending(
      chain({ move: vi.fn(async () => Promise.reject(new UnknownOutcomeError("sig", 9))) }),
    );
    await t.run({ action: "deposit", amount: 10 });
    expect(t.h.pending.pendingFor("p1")?.activity).toMatchObject({
      kind: "earnDeposit",
      symbol: "USDC",
      amount: 10,
    });
  });

  it("has the relayer pay when the review showed it, keeping out every other address", async () => {
    const earnChain = chain();
    const t = lending(earnChain);
    expect(await t.run({ action: "withdraw" }, 30_000n)).toMatchObject({
      signature: "relayed-sig",
    });
    expect(earnChain.moveRelayed).toHaveBeenCalledWith(
      expect.objectContaining({ action: "withdraw", keepOut: [FUNDING_ADDRESS, OTHER_ADDRESS] }),
    );
    expect(earnChain.move).not.toHaveBeenCalled();
  });

  it("lets money lent before archiving come back out", async () => {
    expect(await lending().run({ portfolioId: "p2", action: "withdraw" })).toMatchObject({
      kind: "confirmed",
    });
  });

  it("refuses off mainnet, a zero amount, and a portfolio that is gone", async () => {
    expect(await lending(chain({ available: () => false })).run()).toMatchObject({
      reason: "earnMainnetOnly",
    });
    expect(await lending().run({ amount: 0 })).toMatchObject({ reason: "amountAboveZero" });
    expect(await lending().run({ portfolioId: "nope" })).toMatchObject({ reason: "portfolioGone" });
  });

  it("asks for the cost again when the relayer could not be used, without counting a failure", async () => {
    const t = lending(
      chain({
        moveRelayed: vi.fn(async () => Promise.reject(new ChainError("relayerUnavailable"))),
      }),
    );
    const result = await t.run({}, 30_000n);
    expect(actionFailure(result)).toEqual({
      error:
        "The network cost could not be covered in USDC right now. Nothing was sent. Review the network cost again.",
      reviewAgain: "other",
    });
    expect(t.h.track).not.toHaveBeenCalledWith("earn_failed", expect.anything());
  });

  it("counts a failure in the venue's words", async () => {
    const t = lending(
      chain({ move: vi.fn(async () => Promise.reject(new Error("Jupiter Lend returned 500."))) }),
    );
    expect(await t.run()).toMatchObject({
      kind: "failed",
      reason: "earnFailed",
      detail: "Jupiter Lend returned 500.",
    });
    expect(t.h.track).toHaveBeenCalledWith("earn_failed", { action: "deposit", reason: "other" });
    expect(t.h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("keeps an unknown outcome pending and refuses the same action again", async () => {
    const t = lending(
      chain({ move: vi.fn(async () => Promise.reject(new UnknownOutcomeError("sig", 10))) }),
    );
    expect(await t.run()).toMatchObject({ kind: "unknown", signature: "sig" });
    expect(t.h.pending.pendingFor("p1")).toMatchObject({
      what: "an Earn deposit",
      status: "unknown",
    });
    expect(await t.run()).toMatchObject({ reason: "actionPending" });
  });
});

describe("the network cost of an Earn move that landed", () => {
  it("is written into Activity, and kept with the reservation for a move that lands unseen", async () => {
    const t = lending();
    await t.run({ action: "withdraw", amount: 10 }, 20_000n);
    expect(t.h.wallet().activity[0]).toMatchObject({
      kind: "earnWithdraw",
      amount: 10,
      networkCost: 0.02,
    });

    const unknown = lending(
      chain({ moveRelayed: vi.fn(async () => Promise.reject(new UnknownOutcomeError("s", 700))) }),
    );
    await unknown.run({ action: "deposit", amount: 10 }, 20_000n);
    expect(unknown.h.pending.pendingFor("p1")?.activity).toMatchObject({
      kind: "earnDeposit",
      networkCost: 0.02,
    });
  });

  it("is not recorded when the portfolio paid the network itself", async () => {
    const t = lending();
    await t.run({ action: "deposit", amount: 10 });
    expect(t.h.wallet().activity[0]).not.toHaveProperty("networkCost");
  });

  it("is taken off cash with the move itself when the balances cannot be read back", async () => {
    const withdrawing = lending();
    withdrawing.refresh.portfolioCash.mockResolvedValue(false);
    expect(await withdrawing.run({ action: "withdraw", amount: 10 }, 20_000n)).toMatchObject({
      kind: "confirmed",
      settlement: "balancesEstimated",
    });
    // 50 held, 10 back from Earn, 0.02 of it paid for the network.
    expect(withdrawing.h.holding("p1", "USDC")).toMatchObject({ amount: 59.98 });

    const depositing = lending();
    depositing.refresh.portfolioCash.mockResolvedValue(false);
    await depositing.run({ action: "deposit", amount: 10 }, 20_000n);
    expect(depositing.h.holding("p1", "USDC")).toMatchObject({ amount: 39.98 });
  });

  it("leaves cash as it was read when it could be read", async () => {
    const t = lending();
    await t.run({ action: "withdraw", amount: 10 }, 20_000n);
    expect(t.h.holding("p1", "USDC")).toMatchObject({ amount: 50 });
  });
});

describe("reviewing the cost of Earn", () => {
  it("lets a withdrawal pay the relayer out of what it returns", async () => {
    const t = lending();
    expect(
      await reviewEarnCost(t.deps, {
        portfolioId: "p1",
        action: "withdraw",
        lamportsNeeded: 5_000,
        sample: 1,
        withoutRelayer: false,
      }),
    ).toMatchObject({ kind: "relayer", opens: "cash", fee: 0.03 });
  });

  it("does not ask the relayer with nothing to move", async () => {
    const earnChain = chain();
    const t = lending(earnChain);
    expect(
      await reviewEarnCost(t.deps, {
        portfolioId: "p1",
        action: "deposit",
        lamportsNeeded: 5_000,
        sample: 0,
        withoutRelayer: false,
      }),
    ).toEqual({ kind: "unavailable" });
    expect(earnChain.quoteRelayed).not.toHaveBeenCalled();
  });
});
