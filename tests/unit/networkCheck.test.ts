import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK_CHECK_LIMIT_MS, checkNetwork } from "../../src/application/networkCheck.js";
import { WAIT_LIMIT_MS } from "../../src/presentation/waiting.js";

const MAIN = "main-genesis";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("checking the network as the app opens", () => {
  it("answers for the network it finds", async () => {
    expect(await checkNetwork(async () => MAIN, MAIN)).toBe("ok");
    expect(await checkNetwork(async () => "another", MAIN)).toBe("wrongNetwork");
  });

  it("counts a read that fails as unreachable, at once", async () => {
    const failing = () => Promise.reject(new Error("offline"));
    expect(await checkNetwork(failing, MAIN)).toBe("unreachable");
    expect(
      await checkNetwork(() => {
        throw new Error("no connection");
      }, MAIN),
    ).toBe("unreachable");
  });

  it("stops waiting at the limit for a read that never answers", async () => {
    let settled: string | null = null;
    void checkNetwork(() => new Promise<string>(() => undefined), MAIN).then((check) => {
      settled = check;
    });

    await vi.advanceTimersByTimeAsync(NETWORK_CHECK_LIMIT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe("unreachable");
  });

  it("waits no longer than any other read is waited for", () => {
    expect(NETWORK_CHECK_LIMIT_MS).toBe(8_000);
    expect(NETWORK_CHECK_LIMIT_MS).toBeLessThanOrEqual(WAIT_LIMIT_MS.content);
  });

  it("keeps an answer that comes inside the limit, and leaves no timer running", async () => {
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve(MAIN), 5_000));
    const check = checkNetwork(slow, MAIN);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await check).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an answer that comes after it stopped waiting", async () => {
    const late = () => new Promise<string>((resolve) => setTimeout(() => resolve(MAIN), 40_000));
    const check = checkNetwork(late, MAIN);
    await vi.advanceTimersByTimeAsync(NETWORK_CHECK_LIMIT_MS);
    expect(await check).toBe("unreachable");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await check).toBe("unreachable");
  });
});
