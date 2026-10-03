import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLivePrices, pricesFrom } from "../../src/infrastructure/prices/liveSource.js";
import { ALL_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";

/** Jupiter as a server reads prices from it, with no key. */
const JUPITER_UPSTREAM = { url: "https://api.jup.ag", headers: () => ({}) };

const SOL_MINT = "So11111111111111111111111111111111111111112";
const [STOCK] = ALL_STOCKS;
const STOCK_MINT = STOCK.mint.toBase58();

afterEach(() => vi.unstubAllGlobals());

describe("prices as the app uses them", () => {
  it("passes the index's price on as it is, keyed by symbol", () => {
    const prices = pricesFrom({
      [STOCK_MINT]: { usdPrice: 764.15, priceChange24h: -0.33 },
      [SOL_MINT]: { usdPrice: 200 },
    });
    expect(prices).toEqual({
      [STOCK.symbol]: { usd: 764.15, change24h: -0.33 },
      SOL: { usd: 200, change24h: 0 },
    });
  });

  it("leaves out anything unpriced, unknown or not a positive number", () => {
    const prices = pricesFrom({
      [STOCK_MINT]: null,
      [SOL_MINT]: { usdPrice: 0 },
      "11111111111111111111111111111111": { usdPrice: 5 },
    });
    expect(prices).toEqual({});
  });
});

describe("reading the price index", () => {
  it("asks for at most fifty mints per request and never repeats one", async () => {
    const requested: string[][] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(new URL(url).searchParams.get("ids")!.split(","));
      return Response.json({});
    });

    await loadLivePrices(JUPITER_UPSTREAM);

    expect(requested.length).toBe(Math.ceil((ALL_STOCKS.length + 1) / 50));
    expect(requested.every((ids) => ids.length <= 50)).toBe(true);
    const all = requested.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toContain(SOL_MINT);
    for (const stock of ALL_STOCKS) expect(all).toContain(stock.mint.toBase58());
  });

  it("fails when the index cannot be read at all", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 500 }));
    await expect(loadLivePrices(JUPITER_UPSTREAM)).rejects.toThrow(/could not be read/);
  });
});
