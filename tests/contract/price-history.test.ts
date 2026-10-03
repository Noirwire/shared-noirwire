import { describe, expect, it } from "vitest";
import { loadPriceHistory } from "../../src/infrastructure/prices/historySource.js";
import { JUPITER_UPSTREAM } from "./setup/upstreams.js";
import { loadLivePrices } from "../../src/infrastructure/prices/liveSource.js";
import { TRADABLE_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";

describe("price history against the live source", () => {
  it("returns a real, oldest-first series for SPYx over each range", async () => {
    for (const range of ["1D", "1W", "1M"] as const) {
      const points = await loadPriceHistory("SPYx", range);
      expect(points, range).not.toBeNull();
      // Most of the window must be there: 24 hourly, 42 four-hour, 30 daily candles.
      expect(points!.length, range).toBeGreaterThan(18);
      expect(
        points!.every((close) => close > 100 && close < 5_000),
        range,
      ).toBe(true);
    }
  }, 120_000);

  it("returns null, not a made-up series, for something that is not a stock", async () => {
    expect(await loadPriceHistory("USDC", "1D")).toBeNull();
  });
});

describe("live prices against the live index", () => {
  it("prices SOL and every listed stock", async () => {
    const prices = await loadLivePrices(JUPITER_UPSTREAM);
    for (const symbol of ["SOL", ...TRADABLE_STOCKS.map((stock) => stock.symbol)]) {
      expect(prices[symbol]?.usd, symbol).toBeGreaterThan(0);
    }
  });
});
