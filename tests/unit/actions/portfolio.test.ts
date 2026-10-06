import { describe, expect, it, vi } from "vitest";
import {
  createPortfolio,
  nextDerivationIndex,
} from "../../../src/application/actions/createPortfolio.js";
import { openHoldings, type HoldingsChain } from "../../../src/application/actions/pieOrder.js";
import { createBalanceRefresh } from "../../../src/application/actions/refreshBalances.js";
import { FUNDING } from "../../../src/application/pendingActions.js";
import type { PriceReader } from "../../../src/application/ports.js";
import { ChainError, UnknownOutcomeError } from "../../../src/domain/chainError.js";
import { MAX_ACTIVITY_ENTRIES, type Portfolio } from "../../../src/domain/wallet.js";
import {
  FUNDING_ADDRESS,
  OWN_ADDRESS,
  harness,
  prices,
  wallet,
  type FakeSigner,
} from "../support/actions.js";

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

describe("money arriving in the funding wallet", () => {
  /** The funding wallet holds 100 USDC and no SOL, as stored, and the chain answers `read`. */
  function arriving(
    read: Record<string, number>,
    initial = wallet(),
    priced: PriceReader = prices,
  ) {
    const h = harness(initial);
    const chain = {
      balanceOf: vi.fn(async (_address: string, symbol: string) => read[symbol] ?? 0),
      portfolioBalances: vi.fn(async () => ({ cash: { USDC: 50, SOL: 0 }, trackers: {} })),
      cashBalances: vi.fn(async () => read),
    };
    const refresh = createBalanceRefresh({
      store: h.store,
      chain,
      prices: priced,
      track: h.track,
      shuffle: (items) => items,
    });
    const arrivals = () => h.wallet().activity.filter((entry) => entry.kind === "deposit");
    return { h, chain, refresh, arrivals };
  }

  it("writes what arrived into Activity, by the difference and at the current price", async () => {
    const t = arriving({ SOL: 0.3, USDC: 125.5 });
    expect(await t.refresh.fundingBalances()).toBe(true);
    expect(t.h.wallet().funding).toMatchObject({ sol: 0.3, tokens: { USDC: 125.5 } });
    expect(t.arrivals()).toHaveLength(2);
    expect(t.arrivals()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ portfolioId: FUNDING, symbol: "USDC", amount: 25.5, usd: 25.5 }),
        expect.objectContaining({ portfolioId: FUNDING, symbol: "SOL", amount: 0.3, usd: 30 }),
      ]),
    );
  });

  it("values an arrival at nothing when there is no live price, and still records the amount", async () => {
    const t = arriving({ SOL: 0.3, USDC: 100 }, wallet(), { ...prices, price: () => 0 });
    await t.refresh.fundingBalances();
    expect(t.arrivals()).toEqual([expect.objectContaining({ symbol: "SOL", amount: 0.3, usd: 0 })]);
  });

  it("writes nothing when the balance is unchanged or has gone down", async () => {
    const same = arriving({ SOL: 0, USDC: 100 });
    await same.refresh.fundingBalances();
    expect(same.h.wallet().activity).toEqual([]);

    const less = arriving({ SOL: 0, USDC: 40 });
    await less.refresh.fundingBalances();
    expect(less.h.wallet().funding.tokens.USDC).toBe(40);
    expect(less.h.wallet().activity).toEqual([]);
  });

  it("writes nothing while an action is unsettled, for a portfolio or for the funding wallet", async () => {
    for (const [scope, address] of [
      ["p1", OWN_ADDRESS],
      [FUNDING, FUNDING_ADDRESS],
    ] as const) {
      const t = arriving({ SOL: 0, USDC: 130 });
      const reservation = await t.h.occupy(scope, address);
      await t.refresh.fundingBalances();
      expect(t.h.wallet().funding.tokens.USDC).toBe(130);
      expect(t.arrivals()).toEqual([]);

      // Once it has settled, only what arrives after that is new.
      await reservation?.finish();
      t.chain.cashBalances.mockResolvedValueOnce({ SOL: 0, USDC: 135 });
      await t.refresh.fundingBalances();
      expect(t.arrivals()).toEqual([expect.objectContaining({ symbol: "USDC", amount: 5 })]);
    }
  });

  it("writes nothing when an action was reserved while the read was on its way", async () => {
    const t = arriving({ SOL: 0, USDC: 130 });
    t.chain.cashBalances.mockImplementationOnce(async () => {
      await t.h.occupy(FUNDING, FUNDING_ADDRESS);
      return { SOL: 0, USDC: 130 };
    });
    await t.refresh.fundingBalances();
    expect(t.arrivals()).toEqual([]);
  });

  it("writes nothing from a read that is older than what an action stored meanwhile", async () => {
    const t = arriving({ SOL: 0, USDC: 100 });
    t.chain.cashBalances.mockImplementationOnce(async () => {
      // A send of 40 landed and stored its own read while this one was on its way.
      await t.h.store.update((current) => ({
        ...current,
        funding: { ...current.funding, tokens: { USDC: 60 } },
      }));
      return { SOL: 0, USDC: 100 };
    });
    await t.refresh.fundingBalances();
    expect(t.arrivals()).toEqual([]);
    // The older read does not put the 40 back either.
    expect(t.h.wallet().funding.tokens.USDC).toBe(60);
  });

  it("writes nothing from the read an action makes itself after it lands", async () => {
    const t = arriving({ SOL: 0, USDC: 130 });
    expect(await t.refresh.funding(FUNDING_ADDRESS, "USDC")).toBe(130);
    expect(t.h.wallet().funding.tokens.USDC).toBe(130);
    expect(t.arrivals()).toEqual([]);
  });

  it("does not call what an imported wallet already held an arrival, and records what comes after", async () => {
    const imported = wallet({
      imported: true,
      funding: { address: FUNDING_ADDRESS, sol: 0, tokens: { USDC: 0 } },
    });
    const t = arriving({ SOL: 0.2, USDC: 80 }, imported);
    await t.refresh.fundingBalances();
    expect(t.h.wallet().funding).toMatchObject({
      sol: 0.2,
      tokens: { USDC: 80 },
      balancesRead: true,
    });
    expect(t.arrivals()).toEqual([]);
    expect(t.h.track).toHaveBeenCalledWith("deposit_detected");

    t.chain.cashBalances.mockResolvedValueOnce({ SOL: 0.2, USDC: 100 });
    await t.refresh.fundingBalances();
    expect(t.arrivals()).toEqual([
      expect.objectContaining({ portfolioId: FUNDING, symbol: "USDC", amount: 20, usd: 20 }),
    ]);
  });

  it("records the first money a wallet made here ever receives", async () => {
    const fresh = wallet({ funding: { address: FUNDING_ADDRESS, sol: 0, tokens: { USDC: 0 } } });
    const t = arriving({ SOL: 0, USDC: 80 }, fresh);
    await t.refresh.fundingBalances();
    expect(t.arrivals()).toEqual([expect.objectContaining({ symbol: "USDC", amount: 80 })]);
    expect(t.h.wallet().funding).not.toHaveProperty("balancesRead");
  });

  it("keeps the list within its limit when an arrival is written", async () => {
    const full = wallet({
      activity: Array.from({ length: MAX_ACTIVITY_ENTRIES }, (_, index) => ({
        id: `act_${index}`,
        portfolioId: "p1",
        at: index + 1,
        kind: "fund" as const,
        symbol: "USDC",
        amount: 1,
        usd: 1,
      })),
    });
    const t = arriving({ SOL: 0, USDC: 101 }, full);
    await t.refresh.fundingBalances();
    expect(t.h.wallet().activity).toHaveLength(MAX_ACTIVITY_ENTRIES);
    expect(t.h.wallet().activity[0]).toMatchObject({ kind: "deposit", amount: 1 });
    expect(t.h.wallet().activity.some((entry) => entry.id === "act_0")).toBe(false);
  });
});
