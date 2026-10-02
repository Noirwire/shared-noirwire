import { describe, expect, it, vi } from "vitest";
import { memoryPlatform } from "./testing/index.js";

const complete = {
  crypto: { subtle: {}, getRandomValues: () => undefined },
  TextEncoder: class {},
  TextDecoder: class {},
};

describe("getPlatform", () => {
  it("throws a clear error before anything is installed", async () => {
    vi.resetModules();
    const fresh = await import("./platform.js");
    expect(() => fresh.getPlatform()).toThrow(/Call installPlatform\(\) once at app boot/);
  });

  it("returns what was installed", async () => {
    vi.resetModules();
    const fresh = await import("./platform.js");
    const platform = memoryPlatform();
    fresh.installPlatform(platform);
    expect(fresh.getPlatform()).toBe(platform);
  });
});

describe("assertRuntime", () => {
  it("passes on a runtime with WebCrypto and the text codecs", async () => {
    const { assertRuntime } = await import("./platform.js");
    expect(() => assertRuntime(complete)).not.toThrow();
    expect(() => assertRuntime()).not.toThrow();
  });

  it("names everything that is missing", async () => {
    const { assertRuntime } = await import("./platform.js");
    expect(() => assertRuntime({})).toThrow(
      "missing crypto.subtle, crypto.getRandomValues, TextEncoder, TextDecoder",
    );
    expect(() => assertRuntime({ ...complete, crypto: { subtle: {} } })).toThrow(
      "missing crypto.getRandomValues.",
    );
  });
});

describe("inProcessLocks", () => {
  it("runs holders of one name in turn", async () => {
    const { inProcessLocks } = await import("./platform.js");
    const locks = inProcessLocks();
    const order: string[] = [];
    const slow = locks.withLock("wallet", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("first");
    });
    const fast = locks.withLock("wallet", async () => {
      order.push("second");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["first", "second"]);
  });

  it("does not make one name wait for another", async () => {
    const { inProcessLocks } = await import("./platform.js");
    const locks = inProcessLocks();
    const order: string[] = [];
    let release = () => {};
    const held = locks.withLock("a", () => new Promise<void>((resolve) => (release = resolve)));
    await locks.withLock("b", async () => {
      order.push("b");
    });
    release();
    await held;
    expect(order).toEqual(["b"]);
  });

  it("returns the result, and lets the next holder run after a failure", async () => {
    const { inProcessLocks } = await import("./platform.js");
    const locks = inProcessLocks();
    await expect(
      locks.withLock("wallet", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(locks.withLock("wallet", async () => 7)).resolves.toBe(7);
  });
});
