import { describe, expect, it } from "vitest";
import { TRADABLE, marketsByCategory, searchMarkets, topMovers } from "../../src/wallet/market.js";
import {
  ALL_STOCKS,
  stockBySymbol,
  TRADABLE_STOCKS,
} from "../../src/infrastructure/solana/tokenRegistry.js";

describe("market selectors", () => {
  it("searches ticker and company names without changing the full list for an empty query", () => {
    expect(searchMarkets("  nvidia  ").map((entry) => entry.symbol)).toContain("NVDAx");
    expect(searchMarkets("nvda").map((entry) => entry.symbol)).toContain("NVDAx");
    expect(searchMarkets("")).toBe(TRADABLE);
    expect(searchMarkets("no such company at all")).toEqual([]);
  });

  it("keeps funds, companies and the watchlist distinct", () => {
    const wallet = { watchlist: ["NVDAx", "SPYx"] };
    expect(
      marketsByCategory(wallet, "watchlist")
        .map((entry) => entry.symbol)
        .sort(),
    ).toEqual(["NVDAx", "SPYx"]);
    const funds = marketsByCategory(wallet, "index");
    const companies = marketsByCategory(wallet, "companies");
    expect(funds.map((entry) => entry.symbol)).toContain("SPYx");
    expect(companies.map((entry) => entry.symbol)).toContain("NVDAx");
    expect(funds.length + companies.length).toBe(TRADABLE.length);
    expect(topMovers(null)).toEqual([]);
  });
});

describe("the generated catalog", () => {
  it("has no duplicate symbol or mint, and symbols every route can carry", () => {
    expect(new Set(ALL_STOCKS.map((stock) => stock.symbol)).size).toBe(ALL_STOCKS.length);
    expect(new Set(ALL_STOCKS.map((stock) => stock.mint.toBase58())).size).toBe(ALL_STOCKS.length);
    for (const stock of ALL_STOCKS) expect(stock.symbol).toMatch(/^[A-Za-z0-9.]{1,12}$/);
  });

  it("offers every listed stock to buy and nothing that has been retired", () => {
    expect(TRADABLE.map((entry) => entry.symbol)).toEqual(
      TRADABLE_STOCKS.map((stock) => stock.symbol),
    );
    expect(TRADABLE.some((entry) => stockBySymbol(entry.symbol)?.retired)).toBe(false);
  });

  it("still lists the stocks people already hold", () => {
    for (const symbol of [
      "SPYx",
      "QQQx",
      "NVDAx",
      "AAPLx",
      "TSLAx",
      "METAx",
      "MSFTx",
      "GOOGLx",
      "AMZNx",
      "COINx",
    ]) {
      expect(stockBySymbol(symbol), symbol).toBeDefined();
    }
  });
});
