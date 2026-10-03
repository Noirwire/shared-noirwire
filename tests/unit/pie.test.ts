import { describe, expect, it, vi } from "vitest";
import {
  evenSplit,
  MIN_LEG_USD,
  needsRebalance,
  planInvest,
  planRebalanceSells,
  type SliceState,
} from "../../src/domain/pie.js";
import { pieProblem as problemOf, pieSlices } from "../../src/wallet/market.js";
import { pieProblemMessage } from "../../src/presentation/pie.js";
import type { Portfolio } from "../../src/domain/wallet.js";

/** A slice is valued at its live price, so the tests supply one. */
vi.mock("../../src/infrastructure/prices/live.js", () => ({
  livePrice: (symbol: string) => (symbol === "SPYx" ? { usd: 640, change24h: 0 } : undefined),
}));
/** A stock's display multiplier is a separate read from its live price; fix it at 1 so a given stock price values predictably. */
vi.mock("../../src/infrastructure/prices/multipliers.js", () => ({ stockMultiplier: () => 1 }));

/** The words a person is shown for a mix, or null when it can be saved. */
function pieProblem(slices: Parameters<typeof problemOf>[0]): string | null {
  const problem = problemOf(slices);
  return problem && pieProblemMessage(problem);
}

function slice(symbol: string, weight: number, value: number, amount = value): SliceState {
  return { symbol, weight, value, amount, actual: 0 };
}

function withShares(slices: SliceState[]): SliceState[] {
  const total = slices.reduce((sum, entry) => sum + entry.value, 0);
  return slices.map((entry) => ({ ...entry, actual: total ? (entry.value / total) * 100 : 0 }));
}

describe("pieProblem", () => {
  it("accepts listed stocks with whole weights adding to 100", () => {
    expect(
      pieProblem([
        { symbol: "SPYx", weight: 60 },
        { symbol: "NVDAx", weight: 40 },
      ]),
    ).toBeNull();
  });

  it("names what is wrong with a mix that cannot be saved", () => {
    expect(pieProblem([])).toMatch(/at least one/);
    expect(pieProblem([{ symbol: "SPYx", weight: 90 }])).toMatch(/90%/);
    expect(
      pieProblem([
        { symbol: "SPYx", weight: 50 },
        { symbol: "SPYx", weight: 50 },
      ]),
    ).toMatch(/once/);
    expect(pieProblem([{ symbol: "USDC", weight: 100 }])).toMatch(/listed trackers/);
    expect(
      pieProblem([
        { symbol: "SPYx", weight: 99.5 },
        { symbol: "NVDAx", weight: 0.5 },
      ]),
    ).toMatch(/at least 1%/);
  });
});

describe("evenSplit", () => {
  it("adds up to exactly 100 in whole percent", () => {
    const split = evenSplit(["SPYx", "QQQx", "NVDAx"]);
    expect(split.map((entry) => entry.weight)).toEqual([34, 33, 33]);
    expect(pieProblem(split)).toBeNull();
  });
});

describe("pieSlices", () => {
  it("values each slice and measures its share of the pie only, not of the cash", () => {
    const portfolio = {
      holdings: [
        { symbol: "USDC", amount: 1_000, cost: 1_000 },
        { symbol: "SPYx", amount: 1, cost: 0 },
      ],
      pie: [
        { symbol: "SPYx", weight: 50 },
        { symbol: "NVDAx", weight: 50 },
      ],
    } as Portfolio;
    const [spy, nvda] = pieSlices(portfolio);
    expect(spy.value).toBe(640);
    expect(spy.actual).toBe(100);
    expect(nvda).toMatchObject({ amount: 0, value: 0, actual: 0 });
  });
});

describe("planInvest", () => {
  it("splits an empty pie exactly by weight", () => {
    const legs = planInvest(100, [slice("SPYx", 60, 0), slice("NVDAx", 40, 0)]);
    expect(legs).toEqual([
      { side: "buy", symbol: "SPYx", amount: 60, usd: 60 },
      { side: "buy", symbol: "NVDAx", amount: 40, usd: 40 },
    ]);
  });

  it("fills the slices that are behind before the ones already at target", () => {
    const legs = planInvest(100, [slice("SPYx", 50, 150), slice("NVDAx", 50, 50)]);
    expect(legs).toEqual([{ side: "buy", symbol: "NVDAx", amount: 100, usd: 100 }]);
  });

  it("never spends more than offered, and leaves dust as cash", () => {
    const legs = planInvest(10, [
      slice("SPYx", 34, 0),
      slice("QQQx", 33, 0),
      slice("NVDAx", 32, 0),
      slice("AAPLx", 1, 0),
    ]);
    const spent = legs.reduce((sum, leg) => sum + leg.usd, 0);
    expect(spent).toBeLessThanOrEqual(10);
    expect(legs.every((leg) => leg.usd >= MIN_LEG_USD)).toBe(true);
    expect(legs.map((leg) => leg.symbol)).not.toContain("AAPLx");
  });

  it("plans nothing for no cash", () => {
    expect(planInvest(0, [slice("SPYx", 100, 0)])).toEqual([]);
  });
});

describe("planRebalanceSells", () => {
  it("sells only the excess above target, in tokens", () => {
    const slices = withShares([slice("SPYx", 50, 300, 3), slice("NVDAx", 50, 100, 1)]);
    expect(planRebalanceSells(slices)).toEqual([
      { side: "sell", symbol: "SPYx", amount: 1, usd: 100 },
    ]);
  });

  it("never sells more than is held", () => {
    const slices = withShares([slice("SPYx", 1, 100, 2), slice("NVDAx", 99, 0, 0)]);
    const [leg] = planRebalanceSells(slices);
    expect(leg.amount).toBeLessThanOrEqual(2);
  });
});

describe("needsRebalance", () => {
  it("is quiet for an empty pie and one on target, and speaks up past the drift limit", () => {
    expect(needsRebalance(withShares([slice("SPYx", 50, 0), slice("NVDAx", 50, 0)]))).toBe(false);
    expect(needsRebalance(withShares([slice("SPYx", 50, 101), slice("NVDAx", 50, 99)]))).toBe(
      false,
    );
    expect(needsRebalance(withShares([slice("SPYx", 50, 120), slice("NVDAx", 50, 80)]))).toBe(true);
  });
});
