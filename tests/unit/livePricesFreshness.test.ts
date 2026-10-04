import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_AFTER_MS, freshnessOf } from "../../src/domain/freshness.js";
import {
  POLL_MS,
  livePrice,
  livePricesFreshness,
  watchLivePrices,
} from "../../src/infrastructure/prices/live.js";
import { fakeApi, installTestPlatform, type FakeApi } from "../../src/testing/index.js";

const VISIBLE = { hidden: () => false, subscribe: () => () => undefined };
const PRICES = { prices: { SOL: { usd: 150, change24h: 1 } } };

let api: FakeApi;
let reachable = true;
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  installTestPlatform();
  api = fakeApi({
    "/v1/prices": () => (reachable ? PRICES : new Response("down", { status: 503 })),
    "POST /v1/rpc": () => new Response("down", { status: 503 }),
  });
});

afterEach(() => {
  stop?.();
  api.restore();
  vi.useRealTimers();
});

describe("how current the live prices are", () => {
  it("is known the moment a poll fails, while the last prices are still shown, and clears on the next success", async () => {
    expect(freshnessOf(livePricesFreshness(), Date.now())).toBe("waiting");

    reachable = true;
    stop = watchLivePrices(VISIBLE);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(livePricesFreshness().lastAttemptFailed).toBe(false);
    expect(freshnessOf(livePricesFreshness(), Date.now())).toBe("fresh");
    expect(livePrice("SOL")?.usd).toBe(150);

    // The connection goes mid-session. The next poll fails, a few quiet tries later.
    reachable = false;
    await vi.advanceTimersByTimeAsync(POLL_MS + 5_000);
    const failed = livePricesFreshness();
    expect(failed.lastAttemptFailed).toBe(true);
    expect(Date.now() - failed.succeededAt!).toBeLessThan(STALE_AFTER_MS);
    expect(freshnessOf(failed, Date.now())).toBe("stale");
    // The price read before is still inside its own two minutes, so it is still drawn.
    expect(livePrice("SOL")?.usd).toBe(150);

    reachable = true;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(livePricesFreshness().lastAttemptFailed).toBe(false);
    expect(freshnessOf(livePricesFreshness(), Date.now())).toBe("fresh");
  });
});
