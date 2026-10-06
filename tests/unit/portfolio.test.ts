import { afterEach, describe, expect, it, vi } from "vitest";
import {
  portfolioValue,
  activePortfolios,
  archivedPortfolios,
  cashOf,
  portfolioDayChange,
  dayChangeFor,
  holdingValue,
  investedHoldings,
  isPosition,
  positionAcross,
  portfolioOverview,
  totalValue,
  price,
} from "../../src/wallet/market.js";
import type { Portfolio, Holding, Wallet } from "../../src/domain/wallet.js";

/**
 * `isLivePrice` in src/lib/application/catalog.ts reads through `livePrice` in
 * src/lib/infrastructure/prices/live.ts, whose freshness state is private module state with
 * no exported setter. Stubbing it here is the only way to exercise
 * `dayChangeFor`'s "only while every price is live" gate; the map starts
 * empty, which reproduces the real module's default (no live price fetched
 * yet) and leaves every test above untouched.
 */
const liveOverrides = new Map<string, { usd: number; change24h: number }>();
vi.mock("../../src/infrastructure/prices/live.js", () => ({
  livePrice: (symbol: string) => liveOverrides.get(symbol),
}));
/** A stock's display multiplier is a separate read from its live price; fix it at 1 so a given stock price values predictably. */
vi.mock("../../src/infrastructure/prices/multipliers.js", () => ({ stockMultiplier: () => 1 }));

afterEach(() => {
  liveOverrides.clear();
});

function makeHolding(overrides: Partial<Holding> & Pick<Holding, "symbol">): Holding {
  return { amount: 0, cost: 0, ...overrides };
}

function makePortfolio(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    id: "acc_1",
    label: "Test account",
    address: "addr",
    derivationIndex: 1,
    createdAt: 0,
    archivedAt: null,
    holdings: [],
    ...overrides,
  };
}

function makeWallet(portfolios: Portfolio[]): Wallet {
  return {
    createdAt: 0,
    derivationScheme: "app",
    funding: { address: "funding", sol: 0, tokens: {} },
    portfolios,
    activity: [],
    watchlist: [],
  };
}

describe("holdingValue", () => {
  it("multiplies amount by the asset's current price", () => {
    liveOverrides.set("SOL", { usd: 200, change24h: 0 });
    const holding = makeHolding({ symbol: "SOL", amount: 2 });
    expect(holdingValue(holding)).toBe(2 * price("SOL"));
  });

  it("is 0 for an unknown symbol", () => {
    const holding = makeHolding({ symbol: "NOT-A-REAL-SYMBOL", amount: 5 });
    expect(holdingValue(holding)).toBe(0);
  });
});

describe("a tracker held with no recorded cost", () => {
  it("keeps the part with no cost on record apart when summed across portfolios", () => {
    liveOverrides.set("NVDAx", { usd: 100, change24h: 0 });
    const mixed = makeHolding({ symbol: "NVDAx", amount: 5, cost: 150, uncosted: 3 });
    const wallet = makeWallet([makePortfolio({ holdings: [mixed] })]);
    expect(positionAcross(wallet, "NVDAx")).toEqual({
      amount: 5,
      cost: 150,
      uncosted: 3,
      value: 500,
    });
  });
});

describe("cashOf", () => {
  it("returns the USDC holding's amount", () => {
    const portfolio = makePortfolio({ holdings: [makeHolding({ symbol: "USDC", amount: 42 })] });
    expect(cashOf(portfolio)).toBe(42);
  });

  it("returns 0 when there is no USDC holding", () => {
    const portfolio = makePortfolio({ holdings: [makeHolding({ symbol: "SOL", amount: 1 })] });
    expect(cashOf(portfolio)).toBe(0);
  });
});

describe("isPosition", () => {
  it("is true for a stock", () => {
    expect(isPosition("NVDAx")).toBe(true);
    expect(isPosition("SPYx")).toBe(true);
  });

  it("is false for the cash a position is bought with", () => {
    expect(isPosition("USDC")).toBe(false);
    expect(isPosition("SOL")).toBe(false);
  });

  it("is false for an unknown symbol", () => {
    expect(isPosition("NOTATOKEN")).toBe(false);
  });
});

describe("investedHoldings", () => {
  it("excludes USDC and zero-amount holdings", () => {
    const portfolio = makePortfolio({
      holdings: [
        makeHolding({ symbol: "USDC", amount: 100 }),
        makeHolding({ symbol: "SOL", amount: 0 }),
        makeHolding({ symbol: "NVDAx", amount: 3 }),
      ],
    });
    expect(investedHoldings(portfolio).map((h) => h.symbol)).toEqual(["NVDAx"]);
  });

  it("excludes a real, positive SOL balance too - it is a real onchain balance, not a mock position", () => {
    const portfolio = makePortfolio({
      holdings: [
        makeHolding({ symbol: "SOL", amount: 5 }),
        makeHolding({ symbol: "USDC", amount: 100 }),
        makeHolding({ symbol: "NVDAx", amount: 3 }),
      ],
    });
    expect(investedHoldings(portfolio).map((h) => h.symbol)).toEqual(["NVDAx"]);
  });
});

describe("portfolioValue / totalValue", () => {
  it("sums the USD value of every holding in an account, correctly pricing a real SOL balance (regression for the USDC/SOL data-model bug)", () => {
    liveOverrides.set("SOL", { usd: 100, change24h: 0 });
    const portfolio = makePortfolio({
      holdings: [
        makeHolding({ symbol: "USDC", amount: 10 }),
        makeHolding({ symbol: "SOL", amount: 2 }),
      ],
    });
    // Before the fix, a real SOL amount stored under the "USDC" symbol was priced at
    // price("USDC") === 1 instead of its own price - portfolioValue would have been 10 + 2 = 12.
    expect(portfolioValue(portfolio)).toBe(10 + 2 * price("SOL"));
    expect(portfolioValue(portfolio)).not.toBe(10 + 2);
  });

  it("a real SOL holding never collapses to its raw unit count the way the old USDC-priced-at-1 hack did", () => {
    liveOverrides.set("SOL", { usd: 100, change24h: 0 });
    const portfolio = makePortfolio({
      holdings: [makeHolding({ symbol: "SOL", amount: 1.2 })],
    });
    expect(holdingValue(portfolio.holdings[0])).toBeCloseTo(1.2 * price("SOL"));
    expect(holdingValue(portfolio.holdings[0])).not.toBeCloseTo(1.2);
  });

  it("totalValue only counts active (non-archived) accounts", () => {
    const active = makePortfolio({
      id: "a",
      holdings: [makeHolding({ symbol: "USDC", amount: 10 })],
    });
    const archived = makePortfolio({
      id: "b",
      archivedAt: 123,
      holdings: [makeHolding({ symbol: "USDC", amount: 1000 })],
    });
    const wallet = makeWallet([active, archived]);
    expect(totalValue(wallet)).toBe(10);
  });

  it("totalValue counts what waits in the funding wallet, each token at its own price", () => {
    liveOverrides.set("SOL", { usd: 100, change24h: 0 });
    const wallet = {
      ...makeWallet([makePortfolio({ holdings: [makeHolding({ symbol: "USDC", amount: 10 })] })]),
      funding: { address: "funding", sol: 0.5, tokens: { USDC: 2 } },
    };
    expect(totalValue(wallet)).toBe(10 + 2 + 0.5 * 100);
  });

  it("a total that counts the funding wallet needs a live price for what it holds there", () => {
    const wallet = {
      ...makeWallet([]),
      funding: { address: "funding", sol: 0.5, tokens: { USDC: 2 } },
    };
    expect(portfolioOverview(wallet, Date.now()).valued).toBe(false);
    liveOverrides.set("SOL", { usd: 100, change24h: 0 });
    expect(portfolioOverview(wallet, Date.now()).valued).toBe(true);
    expect(
      portfolioOverview({ ...wallet, funding: { ...wallet.funding, sol: 0 } }, null).valued,
    ).toBe(true);
  });
});

describe("activePortfolios / archivedPortfolios", () => {
  it("partitions accounts by archivedAt", () => {
    const active = makePortfolio({ id: "a", archivedAt: null });
    const archived = makePortfolio({ id: "b", archivedAt: 1 });
    const wallet = makeWallet([active, archived]);
    expect(activePortfolios(wallet).map((a) => a.id)).toEqual(["a"]);
    expect(archivedPortfolios(wallet).map((a) => a.id)).toEqual(["b"]);
  });
});

describe("dayChangeFor", () => {
  it("weights two live trackers' 24h move by their USD value", () => {
    liveOverrides.set("NVDAx", { usd: 100, change24h: 10 });
    liveOverrides.set("AAPLx", { usd: 50, change24h: -4 });
    const portfolio = makePortfolio({
      holdings: [
        makeHolding({ symbol: "NVDAx", amount: 2 }),
        makeHolding({ symbol: "AAPLx", amount: 1 }),
      ],
    });
    const change = dayChangeFor([portfolio], Date.now());
    expect(change).not.toBeNull();
    expect(change!.usd).toBeCloseTo(200 * 0.1 + 50 * -0.04);
    expect(change!.percent).toBeCloseTo(((200 * 0.1 + 50 * -0.04) / 250) * 100);
  });

  it("does not let cash move the figure, live price or not", () => {
    liveOverrides.set("NVDAx", { usd: 100, change24h: 10 });
    const portfolio = makePortfolio({
      holdings: [
        makeHolding({ symbol: "NVDAx", amount: 1 }),
        makeHolding({ symbol: "USDC", amount: 10_000 }),
      ],
    });
    const change = dayChangeFor([portfolio], Date.now());
    expect(change).not.toBeNull();
    expect(change!.usd).toBeCloseTo(10);
    expect(change!.percent).toBeCloseTo(10);
  });

  it("is null while one holding has no live price", () => {
    liveOverrides.set("NVDAx", { usd: 100, change24h: 10 });
    const portfolio = makePortfolio({
      holdings: [
        makeHolding({ symbol: "NVDAx", amount: 1 }),
        makeHolding({ symbol: "AAPLx", amount: 1 }),
      ],
    });
    expect(dayChangeFor([portfolio], Date.now())).toBeNull();
  });

  it("is null for a portfolio that holds no trackers", () => {
    liveOverrides.set("NVDAx", { usd: 100, change24h: 10 });
    const portfolio = makePortfolio({ holdings: [makeHolding({ symbol: "USDC", amount: 500 })] });
    expect(dayChangeFor([portfolio], Date.now())).toBeNull();
  });

  it("is null without a current price read", () => {
    liveOverrides.set("NVDAx", { usd: 100, change24h: 10 });
    const portfolio = makePortfolio({ holdings: [makeHolding({ symbol: "NVDAx", amount: 1 })] });
    expect(dayChangeFor([portfolio], null)).toBeNull();
  });
});

describe("portfolioOverview", () => {
  it("shares active cash, invested value, and consolidated positions", () => {
    liveOverrides.set("NVDAx", { usd: 90, change24h: 0 });
    const wallet = makeWallet([
      makePortfolio({
        id: "a",
        holdings: [
          makeHolding({ symbol: "USDC", amount: 10 }),
          makeHolding({ symbol: "NVDAx", amount: 2 }),
        ],
      }),
      makePortfolio({
        id: "b",
        holdings: [makeHolding({ symbol: "NVDAx", amount: 3 })],
      }),
      makePortfolio({
        id: "archived",
        archivedAt: 1,
        holdings: [makeHolding({ symbol: "USDC", amount: 1000 })],
      }),
    ]);
    const overview = portfolioOverview(wallet, null);
    expect(overview.cash).toBe(10);
    expect(overview.invested).toBe(5 * price("NVDAx"));
    expect([...overview.positions]).toEqual([["NVDAx", 5]]);
    expect(overview.total).toBe(10 + 5 * price("NVDAx"));
    expect(overview.valued).toBe(false);
  });

  it("has no day change until every non-cash price is live", () => {
    const wallet = makeWallet([
      makePortfolio({ holdings: [makeHolding({ symbol: "SOL", amount: 1 })] }),
    ]);
    const overview = portfolioOverview(wallet, Date.now());
    expect(overview.day).toBeNull();
    expect(overview.hasInvestments).toBe(true);
    expect(overview.positions.size).toBe(0);
  });

  it("totals the same weighted day change across accounts as dayChangeFor would alone", () => {
    liveOverrides.set("NVDAx", { usd: 100, change24h: 10 });
    liveOverrides.set("SPYx", { usd: 50, change24h: -2 });
    const wallet = makeWallet([
      makePortfolio({ id: "a", holdings: [makeHolding({ symbol: "NVDAx", amount: 2 })] }),
      makePortfolio({ id: "b", holdings: [makeHolding({ symbol: "SPYx", amount: 4 })] }),
    ]);
    const updatedAt = Date.now();
    const overview = portfolioOverview(wallet, updatedAt);
    expect(overview.day).toEqual(dayChangeFor(activePortfolios(wallet), updatedAt));
    expect(overview.day!.usd).toBeCloseTo(200 * 0.1 + 200 * -0.02);
    expect(overview.day!.percent).toBeCloseTo(((200 * 0.1 + 200 * -0.02) / 400) * 100);
  });
});

describe("positionAcross", () => {
  it("sums amount, cost and value for one symbol across every account", () => {
    liveOverrides.set("SOL", { usd: 80, change24h: 0 });
    const accountA = makePortfolio({
      id: "a",
      holdings: [makeHolding({ symbol: "SOL", amount: 1, cost: 50 })],
    });
    const accountB = makePortfolio({
      id: "b",
      holdings: [makeHolding({ symbol: "SOL", amount: 2, cost: 100 })],
    });
    const wallet = makeWallet([accountA, accountB]);
    const position = positionAcross(wallet, "SOL");
    expect(position.amount).toBe(3);
    expect(position.cost).toBe(150);
    expect(position.value).toBe(3 * price("SOL"));
  });

  it("excludes archived accounts, like every other wallet-wide total", () => {
    const archived = makePortfolio({
      archivedAt: 1,
      holdings: [makeHolding({ symbol: "SOL", amount: 5 })],
    });
    const wallet = makeWallet([archived]);
    expect(positionAcross(wallet, "SOL").amount).toBe(0);
  });
});

describe("portfolioDayChange", () => {
  it("reports a portfolio's day only when it holds a tracker", () => {
    liveOverrides.set("SOL", { usd: 200, change24h: 5 });
    liveOverrides.set("NVDAx", { usd: 100, change24h: 10 });
    const feesOnly = makePortfolio({
      holdings: [
        makeHolding({ symbol: "USDC", amount: 500 }),
        makeHolding({ symbol: "SOL", amount: 0.01 }),
      ],
    });
    const invested = makePortfolio({
      holdings: [
        makeHolding({ symbol: "USDC", amount: 500 }),
        makeHolding({ symbol: "NVDAx", amount: 2 }),
      ],
    });

    expect(portfolioDayChange(feesOnly, Date.now())).toBeNull();
    const change = portfolioDayChange(invested, Date.now());
    expect(change?.usd).toBeCloseTo(20);
    expect(change?.percent).toBeCloseTo(10);
  });

  it("shows nothing when one tracker it holds has no live price", () => {
    liveOverrides.set("NVDAx", { usd: 100, change24h: 10 });
    const portfolio = makePortfolio({
      holdings: [
        makeHolding({ symbol: "NVDAx", amount: 2 }),
        makeHolding({ symbol: "AAPLx", amount: 1 }),
      ],
    });
    expect(portfolioDayChange(portfolio, Date.now())).toBeNull();
    expect(portfolioDayChange(portfolio, null)).toBeNull();
  });
});
