import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { planTrade } from "../../src/infrastructure/solana/swap/execute.js";
import { TRADABLE_STOCKS } from "../../src/infrastructure/solana/tokenRegistry.js";
import { minimumOut, MAX_SLIPPAGE_BPS } from "../../src/infrastructure/solana/swap/types.js";

const STOCK = TRADABLE_STOCKS[0];
const RAW_PER_TOKEN = 10 ** STOCK.decimals;
const MARKET_PRICE = 500;

function venueQuotes(inAmount: string, outAmount: string, threshold: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            inAmount,
            outAmount,
            otherAmountThreshold: threshold,
            slippageBps: MAX_SLIPPAGE_BPS,
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

describe("audit: the price check measures the guaranteed floor", () => {
  // Each quote's expected price is inside the ten percent the check allows;
  // only its floor, what the transaction actually promises, is outside it.
  it("refuses a buy whose guaranteed floor is about 15.8 percent worse than market", async () => {
    const out = BigInt(Math.ceil((100 / 549.9) * RAW_PER_TOKEN));
    const floor = minimumOut(out, MAX_SLIPPAGE_BPS);
    expect(100 / (Number(floor) / RAW_PER_TOKEN) / MARKET_PRICE - 1).toBeGreaterThan(0.15);
    venueQuotes("100000000", String(out), String(floor));
    await expect(plan("buy", 100, MARKET_PRICE)).rejects.toThrow(/worse than the current market/);
  });

  it("refuses a sell whose guaranteed floor is about 14.5 percent below market", async () => {
    const sharesRaw = String(Math.round(0.2 * RAW_PER_TOKEN));
    const out = 90_000_000n;
    const floor = minimumOut(out, MAX_SLIPPAGE_BPS);
    expect(1 - Number(floor) / 1e6 / 0.2 / MARKET_PRICE).toBeGreaterThan(0.14);
    venueQuotes(sharesRaw, String(out), String(floor));
    await expect(plan("sell", 0.2, MARKET_PRICE)).rejects.toThrow(/worse than the current market/);
  });

  it("refuses a quote at any price when no market price is supplied", async () => {
    venueQuotes("100000000", "1", "1");
    await expect(plan("buy", 100, undefined)).rejects.toThrow(/No live price/);
  });
});
