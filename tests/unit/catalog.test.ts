import { afterEach, describe, expect, it, vi } from "vitest";
import { asset, isLivePrice, price, shownUnits, unitsPerHeld } from "../../src/wallet/market.js";

const livePrices = new Map<string, { usd: number; change24h: number }>();
const multipliers = new Map<string, number>();
vi.mock("../../src/infrastructure/prices/live.js", () => ({
  livePrice: (symbol: string) => livePrices.get(symbol),
}));
vi.mock("../../src/infrastructure/prices/multipliers.js", () => ({
  stockMultiplier: (symbol: string) => multipliers.get(symbol),
}));

afterEach(() => {
  livePrices.clear();
  multipliers.clear();
});

describe("a stock is held as raw tokens and shown as share-equivalents", () => {
  it("shows the raw amount times the mint's multiplier, and takes typed amounts back", () => {
    multipliers.set("SPYx", 1.25);
    expect(shownUnits("SPYx", 4)).toBe(5);
    expect(5 / unitsPerHeld("SPYx")!).toBe(4);
  });

  it("prices a shown unit at the market price and a held unit at price times multiplier", () => {
    multipliers.set("SPYx", 1.25);
    livePrices.set("SPYx", { usd: 800, change24h: 1 });

    expect(asset("SPYx")).toMatchObject({ price: 800, change24h: 1 });
    expect(price("SPYx")).toBe(1_000);
    // The same holding either way: 4 raw tokens, shown as 5 share-equivalents.
    expect(4 * price("SPYx")).toBe(shownUnits("SPYx", 4)! * asset("SPYx")!.price);
  });

  it("shows no amount and no value while the multiplier is unknown, rather than a raw one", () => {
    livePrices.set("SPYx", { usd: 800, change24h: 1 });

    expect(shownUnits("SPYx", 4)).toBeUndefined();
    expect(unitsPerHeld("SPYx")).toBeUndefined();
    expect(isLivePrice("SPYx")).toBe(false);
    expect(price("SPYx")).toBe(0);
    expect(asset("SPYx")).toMatchObject({ price: 0, change24h: 0 });
  });

  it("has no price to fall back on when the market price is missing", () => {
    multipliers.set("SPYx", 1.25);
    expect(isLivePrice("SPYx")).toBe(false);
    expect(price("SPYx")).toBe(0);
  });
});

describe("cash and SOL are shown as they are held", () => {
  it("never scales them", () => {
    livePrices.set("SOL", { usd: 200, change24h: 2 });
    expect(shownUnits("SOL", 3)).toBe(3);
    expect(unitsPerHeld("USDC")).toBe(1);
    expect(price("SOL")).toBe(200);
    expect(price("USDC")).toBe(1);
    expect(isLivePrice("USDC")).toBe(true);
  });
});
