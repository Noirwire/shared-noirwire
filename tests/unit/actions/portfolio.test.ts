import { describe, expect, it, vi } from "vitest";
import {
  createPortfolio,
  nextDerivationIndex,
} from "../../../src/application/actions/createPortfolio.js";
import { openHoldings, type HoldingsChain } from "../../../src/application/actions/pieOrder.js";
import { createBalanceRefresh } from "../../../src/application/actions/refreshBalances.js";
import { ChainError, UnknownOutcomeError } from "../../../src/domain/chainError.js";
import type { Portfolio } from "../../../src/domain/wallet.js";
import { FUNDING_ADDRESS, harness, prices, wallet, type FakeSigner } from "../support/actions.js";

describe("creating a portfolio", () => {
  const newPortfolio = (label: string, address: string, derivationIndex: number): Portfolio => ({
    id: `new_${derivationIndex}`,
    label,
    address,
    derivationIndex,
    createdAt: 2,
    archivedAt: null,
    holdings: [],
  });
  const create = (
    h = harness(),
    pie = undefined as { symbol: string; weight: number }[] | undefined,
  ) =>
    createPortfolio(
      {
        ...h.deps,
        newPortfolio,
        fundingIndex: 0,
        pieProblem: (slices) => (slices.length ? null : { reason: "empty" }),
      },
      { label: "Savings", pie },
    );

  it("derives the key past every index in use, archived ones included", async () => {
    const h = harness();
    expect(await create(h)).toMatchObject({
      kind: "created",
      portfolio: { label: "Savings", address: "Derived3", derivationIndex: 3 },
    });
    expect(h.wallet().portfolios[0].label).toBe("Savings");
    expect(h.track).toHaveBeenCalledWith("account_created", { kind: "portfolio" });
    expect(nextDerivationIndex(wallet({ portfolios: [] }), 0)).toBe(1);
  });

  it("refuses a mix that cannot be saved, and a locked wallet", async () => {
    expect(await create(harness(), [])).toEqual({
      kind: "invalidPie",
      problem: { reason: "empty" },
    });
    const h = harness();
    h.lock();
    expect(await create(h)).toMatchObject({ kind: "refused", reason: "walletLocked" });
  });
});

describe("opening a pie's tracker accounts", () => {
  function opening(over: Partial<HoldingsChain<FakeSigner, string>> = {}, h = harness()) {
    const chain: HoldingsChain<FakeSigner, string> = {
      stock: (symbol) => (symbol === "RETIREDx" ? undefined : symbol),
      openHolding: vi.fn(async ({ stock }) => (stock === "SPYx" ? null : `open-${stock}`)),
      ...over,
    };
    const refresh = { portfolioCash: vi.fn(async () => true) };
    return {
      h,
      chain,
      run: (symbols: string[]) =>
        openHoldings(
          { ...h.deps, chain, refresh },
          { portfolioId: "p1", symbols, reviewedFeeRaw: 2_000_000n },
        ),
    };
  }

  it("opens each listed tracker's account, skipping one already open, before any order", async () => {
    const t = opening();
    expect(await t.run(["SPYx", "NVDAx", "RETIREDx"])).toEqual({
      kind: "confirmed",
      settlement: "balancesRead",
    });
    expect(t.chain.openHolding).toHaveBeenCalledTimes(2);
    expect(t.chain.openHolding).toHaveBeenCalledWith(
      expect.objectContaining({ stock: "NVDAx", keepOut: [FUNDING_ADDRESS, "Portfolio222"] }),
    );
    expect(t.h.pending.pendingFor("p1")).toBeUndefined();
  });

  it("stops at the first relayer that cannot be used, saying which accounts are already open", async () => {
    const openHolding = vi
      .fn()
      .mockResolvedValueOnce("open-NVDAx")
      .mockRejectedValueOnce(new ChainError("relayerUnavailable"));
    const t = opening({ openHolding });
    expect(await t.run(["NVDAx", "AAPLx"])).toEqual({
      kind: "needsReview",
      change: { because: "relayerUnavailable" },
      completed: [{ step: "accountOpened", opens: "holding", signature: "open-NVDAx" }],
    });
  });

  it("keeps an unknown opening pending, and refuses another while it is", async () => {
    const t = opening({
      openHolding: vi.fn(async () => Promise.reject(new UnknownOutcomeError())),
    });
    expect(await t.run(["NVDAx"])).toMatchObject({ kind: "unknown" });
    expect(await t.run(["NVDAx"])).toMatchObject({ kind: "refused", reason: "actionPending" });
  });

  it("refuses a portfolio that is gone", async () => {
    const h = harness();
    expect(
      await openHoldings(
        { ...h.deps, chain: opening().chain, refresh: { portfolioCash: async () => true } },
        { portfolioId: "nope", symbols: [], reviewedFeeRaw: 1n },
      ),
    ).toMatchObject({ reason: "portfolioGone" });
  });
});

describe("refreshing balances", () => {
  function refreshing(h = harness()) {
    const chain = {
      balanceOf: vi.fn(async () => 7),
      portfolioBalances: vi.fn(async () => ({
        cash: { USDC: 12, SOL: 0.1 },
        trackers: { SPYx: 3 },
      })),
      cashBalances: vi.fn(async () => ({ SOL: 0.2, USDC: 9 })),
    };
    return {
      h,
      chain,
      refresh: createBalanceRefresh({
        store: h.store,
        chain,
        prices,
        track: h.track,
        shuffle: (items) => items,
      }),
    };
  }

  it("counts the first deposit seen in a funding wallet that had nothing", async () => {
    const t = refreshing(
      harness(wallet({ funding: { address: FUNDING_ADDRESS, sol: 0, tokens: {} } })),
    );
    await t.refresh.fundingBalances();
    expect(t.h.wallet().funding).toMatchObject({ sol: 0.2, tokens: { USDC: 9 } });
    expect(t.h.track).toHaveBeenCalledWith("deposit_detected");
  });

  it("reads every active portfolio one at a time, and joins a refresh already running", async () => {
    const t = refreshing();
    await Promise.all([t.refresh.allPortfolios(), t.refresh.allPortfolios()]);
    expect(t.chain.portfolioBalances).toHaveBeenCalledTimes(1);
    expect(t.h.holding("p1", "USDC")).toMatchObject({ amount: 12 });
    expect(t.h.holding("p1", "SPYx")).toMatchObject({ amount: 3 });
  });

  it("reports a read that failed instead of hiding it, keeping what was stored", async () => {
    const t = refreshing();
    expect(await t.refresh.everything()).toBe(true);
    expect(t.chain.cashBalances).toHaveBeenCalledBefore(t.chain.portfolioBalances);

    t.chain.portfolioBalances.mockRejectedValueOnce(new Error("unreachable"));
    expect(await t.refresh.allPortfolios()).toBe(false);
    expect(t.h.holding("p1", "USDC")).toMatchObject({ amount: 12 });

    t.chain.cashBalances.mockRejectedValueOnce(new Error("unreachable"));
    expect(await t.refresh.fundingBalances()).toBe(false);
    t.chain.cashBalances.mockRejectedValueOnce(new Error("unreachable"));
    expect(await t.refresh.everything()).toBe(false);
    expect(await t.refresh.everything()).toBe(true);
  });

  it("says when a portfolio could not be read, so orders are not sized from a stale one", async () => {
    const t = refreshing();
    t.chain.portfolioBalances.mockRejectedValueOnce(new Error("rate limited"));
    expect(await t.refresh.portfolioBalances("p1")).toBeUndefined();
    expect(await t.refresh.portfolioBalances("p1")).toMatchObject({ id: "p1" });
  });
});
