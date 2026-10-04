import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERIES_TTL_SECONDS } from "../../src/domain/priceRanges.js";
import { memoryVault, type MemoryVault } from "../../src/testing/index.js";

let vault: MemoryVault;

/**
 * The chart cache lives in module scope, so a freshly imported copy is a
 * freshly loaded page, with the platform installed again over the same vault.
 */
async function loadPage() {
  vi.resetModules();
  const { installTestPlatform } = await import("../../src/testing/index.js");
  installTestPlatform({ vault });
  return import("../../src/infrastructure/prices/history.js");
}

describe("the price history cache", () => {
  let fetched: ReturnType<typeof vi.fn>;
  let series: number[] | null;

  beforeEach(() => {
    vault = memoryVault();
    vi.useFakeTimers();
    series = [1, 2, 3];
    fetched = vi.fn(async () => ({ ok: true, json: async () => ({ points: series }) }));
    vi.stubGlobal("fetch", fetched);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("answers a second request for the same chart from memory", async () => {
    const { priceHistory } = await loadPage();
    expect(await priceHistory("NVDAx", "1D")).toEqual([1, 2, 3]);
    expect(await priceHistory("NVDAx", "1D")).toEqual([1, 2, 3]);
    expect(fetched).toHaveBeenCalledTimes(1);

    await priceHistory("NVDAx", "1W");
    await priceHistory("SPYx", "1D");
    expect(fetched).toHaveBeenCalledTimes(3);
  });

  it("asks again once the chart is older than its range allows", async () => {
    const { priceHistory } = await loadPage();
    await priceHistory("NVDAx", "1D");
    vi.advanceTimersByTime(SERIES_TTL_SECONDS["1D"] * 1000 - 1);
    await priceHistory("NVDAx", "1D");
    expect(fetched).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await priceHistory("NVDAx", "1D");
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it("forgets a failed read at once, so the next one asks again", async () => {
    const { priceHistory } = await loadPage();
    series = null;
    expect(await priceHistory("NVDAx", "1D")).toBeNull();
    series = [4, 5];
    expect(await priceHistory("NVDAx", "1D")).toEqual([4, 5]);
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it("writes nothing to storage, and a reload starts with no chart", async () => {
    const written = vi.spyOn(vault, "update");
    await (await loadPage()).priceHistory("NVDAx", "1D");
    expect(written).not.toHaveBeenCalled();
    expect(vault.keys()).toHaveLength(0);

    await (await loadPage()).priceHistory("NVDAx", "1D");
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});
