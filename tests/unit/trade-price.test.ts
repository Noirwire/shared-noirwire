import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { checkQuotedPrice, planTrade } from "../../src/infrastructure/solana/swap/execute.js";
import { TRADABLE_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";

const STOCK = TRADABLE_STOCKS[0];
const RAW_PER_TOKEN = 10 ** STOCK.decimals;
/** Dollars per raw token: the feed's price per share times the mint's display multiplier. */
const MARKET_PRICE = 500;

const HUNDRED_USDC = "100000000";
const raw = (tokens: number) => String(Math.round(tokens * RAW_PER_TOKEN));

/** A venue that answers any order request with these amounts, internally consistent. */
function venueQuotes(inAmount: string, outAmount: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            inAmount,
            outAmount,
            otherAmountThreshold: outAmount,
            slippageBps: 0,
            requestId: "request",
          }),
          { status: 200 },
        ),
    ),
  );
}

const plan = (side: "buy" | "sell", amount: number, marketPrice?: number) =>
  planTrade({ owner: Keypair.generate(), side, symbol: STOCK.symbol, amount, marketPrice });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a quote held against the market price", () => {
  it("offers a buy priced at the market, and one priced better", async () => {
    venueQuotes(HUNDRED_USDC, raw(0.2));
    expect(await plan("buy", 100, MARKET_PRICE)).toMatchObject({
      unitPrice: 500,
      priceChecked: true,
    });
    venueQuotes(HUNDRED_USDC, raw(0.4));
    expect((await plan("buy", 100, MARKET_PRICE)).priceChecked).toBe(true);
  });

  it("refuses a buy that hands back one raw unit for a hundred dollars", async () => {
    // Every figure in the response agrees with every other: the floor equals
    // the quoted output. Only a price from outside it shows what it is.
    venueQuotes(HUNDRED_USDC, "1");
    await expect(plan("buy", 100, MARKET_PRICE)).rejects.toThrow(/worse than the current market/);
  });

  it("offers a sell priced at the market, and one priced better", async () => {
    venueQuotes(raw(0.2), HUNDRED_USDC);
    expect(await plan("sell", 0.2, MARKET_PRICE)).toMatchObject({
      unitPrice: 500,
      priceChecked: true,
    });
    venueQuotes(raw(0.2), "150000000");
    expect((await plan("sell", 0.2, MARKET_PRICE)).priceChecked).toBe(true);
  });

  it("refuses a sell that pays a dollar for a hundred dollars of stock", async () => {
    venueQuotes(raw(0.2), "1000000");
    await expect(plan("sell", 0.2, MARKET_PRICE)).rejects.toThrow(/worse than the current market/);
  });

  it("draws the line at ten percent, in the direction that hurts", () => {
    expect(checkQuotedPrice("buy", 550, 500)).toBe(true);
    expect(() => checkQuotedPrice("buy", 550.01, 500)).toThrow();
    expect(checkQuotedPrice("buy", 1, 500)).toBe(true);
    expect(checkQuotedPrice("sell", 450, 500)).toBe(true);
    expect(() => checkQuotedPrice("sell", 449.99, 500)).toThrow();
    expect(checkQuotedPrice("sell", 5_000, 500)).toBe(true);
  });

  it("does not block when there is no market price, and says the price went unchecked", async () => {
    venueQuotes(HUNDRED_USDC, "1");
    expect((await plan("buy", 100)).priceChecked).toBe(false);
    expect(checkQuotedPrice("buy", 500, 0)).toBe(false);
  });
});
