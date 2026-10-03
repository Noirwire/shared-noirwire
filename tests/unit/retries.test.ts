import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { earn, type EarnChain } from "../../src/application/actions/earn.js";
import { createBalanceRefresh } from "../../src/application/actions/refreshBalances.js";
import { reviewSend, send, type SendChain } from "../../src/application/actions/send.js";
import {
  placeTrade,
  quoteTrade,
  reviewOrdersCost,
  type TradeChain,
  type TradeOrder,
} from "../../src/application/actions/trade.js";
import { planNetworkCost } from "../../src/application/networkCost.js";
import {
  READ_RETRY,
  isBusyStatus,
  isTransient,
  readWithRetries,
  withRetries,
} from "../../src/application/retries.js";
import { ChainError, UnknownOutcomeError } from "../../src/domain/chainError.js";
import { priceHistory } from "../../src/infrastructure/prices/history.js";
import { refreshMultipliers } from "../../src/infrastructure/prices/multipliers.js";
import { readFetch } from "../../src/infrastructure/readFetch.js";
import { checkRecipient } from "../../src/infrastructure/solana/address.js";
import { connection } from "../../src/infrastructure/solana/client.js";
import { relayerPins, resetRelayerPins } from "../../src/infrastructure/solana/relayer.js";
import { installPlatform } from "../../src/platform.js";
import { memoryPlatform, testEnv } from "../../src/testing/index.js";
import { harness, RECIPIENT, type FakeSigner } from "./support/actions.js";

/** How a request that never got through fails on each runtime. */
const dropped = () => new TypeError("fetch failed");
const busy = () => new Error("502 Bad Gateway");

/** A read that fails `failures` times with `error()` and then answers `value`. */
function flaky<T>(failures: number, value: T, error: () => Error = dropped) {
  let left = failures;
  return vi.fn(async (): Promise<T> => {
    if (left-- > 0) throw error();
    return value;
  });
}

/** Runs `work` to its end with every pause skipped. */
async function settled<T>(work: Promise<T>): Promise<T> {
  const outcome = work.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("withRetries", () => {
  const options = { tries: 3, pauseMs: 400, retryable: isTransient };

  it("answers at once when the first try does, with no pause", async () => {
    const attempt = flaky(0, "ok");
    expect(await withRetries(attempt, options)).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses 400 ms, then 800 ms, between its three tries", async () => {
    const attempt = flaky(2, "ok");
    const work = withRetries(attempt, options);
    await vi.advanceTimersByTimeAsync(399);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(799);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await work).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("throws the last failure as it was once the tries are used up", async () => {
    const attempt = flaky(5, "ok", busy);
    await expect(settled(withRetries(attempt, options))).rejects.toThrow("502 Bad Gateway");
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("throws a failure that is not retryable at once", async () => {
    const attempt = flaky(1, "ok", () => new Error("This address is a program."));
    await expect(withRetries(attempt, options)).rejects.toThrow("program");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("reads with three tries by default", () => {
    expect(READ_RETRY).toEqual({ tries: 3, pauseMs: 400 });
  });
});

describe("isTransient", () => {
  it("is a request that never got through, ran out of time, or came back 429 or 5xx", () => {
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransient(new TypeError("Network request failed"))).toBe(true);
    expect(isTransient(new DOMException("The operation timed out.", "TimeoutError"))).toBe(true);
    expect(isTransient(new Error("429 Too Many Requests: slow down"))).toBe(true);
    expect(isTransient(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransient(new Error("Jupiter returned 502."))).toBe(true);
    expect([429, 500, 503].every(isBusyStatus)).toBe(true);
  });

  it("is never an answer: a refusal, a typed code, a 4xx, or a guard's own account", () => {
    expect(isTransient(new ChainError("noQuote"))).toBe(false);
    expect(isTransient(new ChainError("relayerUnavailable"))).toBe(false);
    expect(isTransient(new UnknownOutcomeError("sig", 10))).toBe(false);
    expect(isTransient(new Error("Jupiter returned 400."))).toBe(false);
    expect(isTransient(new Error("This swap would deliver less than quoted."))).toBe(false);
    expect(isTransient("fetch failed")).toBe(false);
    expect([200, 400, 404].some(isBusyStatus)).toBe(false);
  });
});

describe("the balance refresh", () => {
  function refreshing(chain: Parameters<typeof createBalanceRefresh>[0]["chain"]) {
    const h = harness();
    const refresh = createBalanceRefresh({
      store: h.store,
      chain,
      prices: h.deps.prices,
      track: h.track,
      shuffle: (items) => items,
    });
    return { h, refresh };
  }
  const balances = { cash: { SOL: 0, USDC: 75 }, trackers: {} };

  it("asks again for a portfolio's balances on a busy moment, and stores what came back", async () => {
    const portfolioBalances = flaky(2, balances);
    const { h, refresh } = refreshing({
      portfolioBalances,
      balanceOf: async () => 0,
      cashBalances: async () => ({ SOL: 0, USDC: 100 }),
    });
    expect(await settled(refresh.portfolioCash("p1", "Portfolio111"))).toBe(true);
    expect(portfolioBalances).toHaveBeenCalledTimes(3);
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 75 });
  });

  it("asks again for the funding wallet's balances and for one balance", async () => {
    const cashBalances = flaky(1, { SOL: 0, USDC: 120 }, busy);
    const balanceOf = flaky(1, 9);
    const { h, refresh } = refreshing({
      portfolioBalances: async () => balances,
      balanceOf,
      cashBalances,
    });
    expect(await settled(refresh.fundingBalances())).toBe(true);
    expect(h.wallet().funding.tokens.USDC).toBe(120);
    expect(await settled(refresh.portfolioAsset("p1", "Portfolio111", "USDC"))).toBe(9);
    expect(balanceOf).toHaveBeenCalledTimes(2);
  });

  it("says the read failed only after three tries, keeping the stored values", async () => {
    const portfolioBalances = flaky(9, balances);
    const { h, refresh } = refreshing({
      portfolioBalances,
      balanceOf: async () => 0,
      cashBalances: async () => ({}),
    });
    expect(await settled(refresh.portfolioCash("p1", "Portfolio111"))).toBe(false);
    expect(portfolioBalances).toHaveBeenCalledTimes(3);
    expect(h.holding("p1", "USDC")).toMatchObject({ amount: 50 });
  });
});

describe("preparing a review", () => {
  const cost = { balance: async () => 0, shortfall: async () => ({ required: 1 }) };
  const need = { owner: "Portfolio111", lamportsNeeded: 5_000, cashFree: 50 };

  it("asks the relayer for its price again on a busy moment", async () => {
    const quote = flaky(2, { feeRaw: 20_000n, opensAccount: false });
    expect(
      await settled(planNetworkCost({ ...need, relayer: { quote, opens: "recipient" } }, cost)),
    ).toMatchObject({ kind: "relayer", feeRaw: 20_000n });
    expect(quote).toHaveBeenCalledTimes(3);
  });

  it("does not ask a relayer that refused again", async () => {
    const quote = vi.fn(async () => Promise.reject(new ChainError("relayerUnavailable")));
    expect(
      await settled(planNetworkCost({ ...need, relayer: { quote, opens: "recipient" } }, cost)),
    ).toEqual({ kind: "unavailable" });
    expect(quote).toHaveBeenCalledTimes(1);
  });

  it("asks again for the portfolio's own balance when it pays itself", async () => {
    const balance = flaky(1, 10_000_000);
    expect(
      await settled(
        planNetworkCost({ ...need, solPrice: 100 }, { balance, shortfall: async () => null }),
      ),
    ).toMatchObject({ kind: "ownSol" });
    expect(balance).toHaveBeenCalledTimes(2);
  });

  it("asks again for what a send costs before saying the cost is unavailable", async () => {
    const h = harness();
    const sendLamports = flaky(2, 2_000_000);
    const chain: SendChain<FakeSigner> = {
      asset: () => undefined,
      token: (symbol) => ({
        symbol,
        decimals: 6,
        sendLamports,
        quoteRelayed: async () => ({ feeRaw: 20_000n, opensAccount: false }),
      }),
      isRecipientAddress: () => true,
      cashSymbol: "USDC",
      networkFeeSol: 0.000005,
      cost,
    };
    expect(
      await settled(
        reviewSend(
          { ...h.deps, chain },
          {
            portfolioId: "p1",
            send: { symbol: "USDC", amount: 10, to: RECIPIENT },
            withoutRelayer: false,
          },
        ),
      ),
    ).toMatchObject({ cost: { kind: "relayer" }, amount: 10 });
    expect(sendLamports).toHaveBeenCalledTimes(3);
  });
});

type Plan = TradeOrder & { built: boolean };

const priced: Plan = {
  side: "buy",
  stock: { symbol: "SPYx" },
  spend: 20,
  receive: 2,
  receiveAtLeast: 1.9,
  unitPrice: 10,
  venue: "Jupiter",
  priceChecked: true,
  built: true,
  quote: { feeBps: 50, gasless: true },
};

function tradeChain(over: Partial<TradeChain<FakeSigner, Plan>> = {}) {
  const chain: TradeChain<FakeSigner, Plan> = {
    available: () => true,
    isStock: (symbol) => symbol === "SPYx",
    plan: vi.fn(async () => priced),
    isBuilt: (entry) => entry.built,
    execute: vi.fn(async () => "trade-sig"),
    gaslessFromUsd: 12,
    cashSymbol: "USDC",
    holdingOpen: vi.fn(async () => true),
    quoteOpenHolding: vi.fn(async () => ({ feeRaw: 2_000_000n, opensAccount: true })),
    openHolding: vi.fn(async () => "open-sig"),
    tradeBalances: vi.fn(async (): Promise<[number, number]> => [2, 30]),
    balanceOf: vi.fn(async () => 2),
    cost: { balance: async () => 0, shortfall: async () => ({ required: 1 }) },
    ...over,
  };
  const h = harness();
  const refresh = {
    funding: vi.fn(async () => 0),
    portfolioAsset: vi.fn(async () => 0),
    portfolioCash: vi.fn(async () => true),
  };
  return { h, chain, deps: { ...h.deps, chain, refresh } };
}

describe("pricing a trade", () => {
  const order = { portfolioId: "p1", side: "buy" as const, symbol: "SPYx", amount: 20 };

  it("asks for the price again on a busy moment", async () => {
    const plan = flaky(2, priced, () => new Error("Jupiter returned 503."));
    const t = tradeChain({ plan });
    expect(await settled(quoteTrade(t.deps, order))).toEqual({ kind: "quoted", plan: priced });
    expect(plan).toHaveBeenCalledTimes(3);
  });

  it("takes no price for an answer, and does not ask again", async () => {
    const plan = vi.fn(async () => Promise.reject(new ChainError("noQuote")));
    const t = tradeChain({ plan });
    await t.h.store.update((wallet) => ({
      ...wallet,
      portfolios: wallet.portfolios.map((entry) =>
        entry.id === "p1"
          ? { ...entry, holdings: [{ symbol: "SOL", amount: 1, cost: 100 }] }
          : entry,
      ),
    }));
    expect(await settled(quoteTrade(t.deps, order))).toMatchObject({
      kind: "failed",
      cause: "noQuote",
    });
    expect(plan).toHaveBeenCalledTimes(1);
  });

  it("asks again whether the holding is open when working out the orders' cost", async () => {
    const holdingOpen = flaky(1, false);
    const t = tradeChain({ holdingOpen });
    const unbuilt = { ...priced, built: false, quote: { feeBps: 50, gasless: false } };
    expect(
      await settled(
        reviewOrdersCost(t.deps, {
          portfolioId: "p1",
          plans: [unbuilt],
          lamportsNeeded: 2_000_000,
          withoutRelayer: false,
        }),
      ),
    ).toMatchObject({ kind: "relayer", opens: "holding" });
    expect(holdingOpen).toHaveBeenCalledTimes(2);
  });
});

describe("what is never tried twice", () => {
  it("a send that failed on the way out is not sent again", async () => {
    const h = harness();
    const sendRelayed = vi.fn(async () => Promise.reject(dropped()));
    const chain: SendChain<FakeSigner> = {
      asset: (symbol) => ({
        symbol,
        balance: async () => 50,
        ensureAccount: async () => undefined,
        deposit: async () => undefined,
        withdraw: async () => undefined,
        sendRelayed,
      }),
      token: () => undefined,
      isRecipientAddress: () => true,
      cashSymbol: "USDC",
      networkFeeSol: 0.000005,
      cost: { balance: async () => 0, shortfall: async () => null },
    };
    const result = await settled(
      send(
        { ...h.deps, chain },
        {
          portfolioId: "p1",
          send: { symbol: "USDC", amount: 10, to: RECIPIENT },
          network: { relayerFeeRaw: 20_000n },
        },
      ),
    );
    expect(result).toMatchObject({ kind: "failed", reason: "sendFailed" });
    expect(sendRelayed).toHaveBeenCalledTimes(1);
  });

  it("an order that failed on the way out is not placed again, nor priced again", async () => {
    const execute = vi.fn(async () => Promise.reject(busy()));
    const t = tradeChain({ execute });
    const result = await settled(placeTrade(t.deps, { portfolioId: "p1", reviewed: priced }));
    expect(result).toMatchObject({ kind: "failed", reason: "tradeFailed" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(t.chain.plan).not.toHaveBeenCalled();
  });

  it("the price taken while placing an order is asked for once", async () => {
    const plan = vi.fn(async () => Promise.reject(dropped()));
    const t = tradeChain({ plan });
    const unbuilt = { ...priced, built: false };
    const result = await settled(placeTrade(t.deps, { portfolioId: "p1", reviewed: unbuilt }));
    expect(result).toMatchObject({ kind: "failed" });
    expect(plan).toHaveBeenCalledTimes(1);
    expect(t.chain.execute).not.toHaveBeenCalled();
  });

  it("an Earn move that failed on the way out is not made again", async () => {
    const h = harness();
    const moveRelayed = vi.fn(async () => Promise.reject(dropped()));
    const chain: EarnChain<FakeSigner> = {
      available: () => true,
      move: vi.fn(async () => "lend-sig"),
      moveRelayed,
      quoteRelayed: async () => ({ feeRaw: 30_000n, opensAccount: true }),
      cashSymbol: "USDC",
      cost: { balance: async () => 0, shortfall: async () => null },
    };
    const result = await settled(
      earn(
        { ...h.deps, chain, refresh: { portfolioCash: async () => true } },
        { portfolioId: "p1", action: "deposit", amount: 10, network: { relayerFeeRaw: 30_000n } },
      ),
    );
    expect(result).toMatchObject({ kind: "failed", reason: "earnFailed" });
    expect(moveRelayed).toHaveBeenCalledTimes(1);
  });
});

describe("the clients' reads", () => {
  it("asks about a recipient again on a busy moment", async () => {
    const read = vi
      .spyOn(connection, "getAccountInfo")
      .mockRejectedValueOnce(dropped())
      .mockResolvedValue(null);
    expect(await settled(checkRecipient(Keypair.generate().publicKey.toBase58()))).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("fetches a read again when it never got through or came back 429 or 5xx", async () => {
    const fetched = vi
      .fn()
      .mockRejectedValueOnce(dropped())
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetched);
    expect((await settled(readFetch("/api/prices"))).status).toBe(200);
    expect(fetched).toHaveBeenCalledTimes(3);
  });

  it("hands back a 4xx as the answer it is", async () => {
    const fetched = vi.fn(async () => new Response("no", { status: 404 }));
    vi.stubGlobal("fetch", fetched);
    expect((await settled(readFetch("/api/history/NVDAx/1D"))).status).toBe(404);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("loads a chart's history on the second try", async () => {
    const fetched = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 502 }))
      .mockResolvedValue(Response.json({ points: [1, 2, 3] }));
    vi.stubGlobal("fetch", fetched);
    expect(await settled(priceHistory("RETRYx", "1D"))).toEqual([1, 2, 3]);
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it("reads the relayer's keys on the second try", async () => {
    resetRelayerPins();
    const key = Keypair.generate().publicKey.toBase58();
    const fetched = vi
      .fn()
      .mockRejectedValueOnce(dropped())
      .mockResolvedValue(Response.json({ available: true, feePayers: [key], paymentWallet: key }));
    vi.stubGlobal("fetch", fetched);
    expect((await settled(relayerPins()))?.paymentWallet.toBase58()).toBe(key);
    expect(fetched).toHaveBeenCalledTimes(2);
    resetRelayerPins();
  });

  it("reads the trackers' multipliers on the second try", async () => {
    installPlatform(memoryPlatform({ env: testEnv({ network: "mainnet-beta" }) }));
    const read = vi
      .spyOn(connection, "getMultipleAccountsInfo")
      .mockRejectedValueOnce(busy())
      .mockImplementation(async (addresses) => addresses.map(() => null));
    await settled(refreshMultipliers());
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
    installPlatform(memoryPlatform());
  });

  it("reads through the default policy", async () => {
    const attempt = flaky(2, 7);
    expect(await settled(readWithRetries(attempt))).toBe(7);
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
