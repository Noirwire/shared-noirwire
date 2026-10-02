import { describe, expect, it, vi } from "vitest";
import {
  fixedRelay,
  manualActivity,
  memoryPlatform,
  memoryStorage,
  recordingTrack,
  testEnv,
} from "./index.js";

describe("memoryStorage", () => {
  it("stores, lists and removes like localStorage", () => {
    const storage = memoryStorage({ seeded: "1" });
    storage.setItem("wallet", "sealed");
    expect(storage.getItem("wallet")).toBe("sealed");
    expect(storage.getItem("absent")).toBeNull();
    expect(storage.keys()).toEqual(["seeded", "wallet"]);
    storage.removeItem("seeded");
    expect(storage.keys()).toEqual(["wallet"]);
  });
});

describe("fixedRelay", () => {
  it("hands out a fresh copy of its headers", () => {
    const relay = fixedRelay("https://relay.test", { "x-client": "mobile" });
    relay.headers()["x-client"] = "changed";
    expect(relay.headers()).toEqual({ "x-client": "mobile" });
    expect(relay.baseUrl).toBe("https://relay.test");
  });
});

describe("testEnv", () => {
  it("defaults to devnet with no fee, and takes overrides", () => {
    expect(testEnv()).toEqual({ network: "devnet", referralAccount: null, feeBps: 0 });
    expect(testEnv({ feeBps: 50 }).feeBps).toBe(50);
  });
});

describe("manualActivity", () => {
  it("notifies subscribers until they unsubscribe", () => {
    const activity = manualActivity();
    const onActive = vi.fn();
    const unsubscribe = activity.subscribe(onActive);
    activity.fire();
    unsubscribe();
    activity.fire();
    expect(onActive).toHaveBeenCalledTimes(1);
  });
});

describe("recordingTrack", () => {
  it("records each event with its props", () => {
    const { track, events } = recordingTrack();
    track("wallet_created");
    track("trade_confirmed", { side: "buy" });
    expect(events).toEqual([
      { event: "wallet_created" },
      { event: "trade_confirmed", props: { side: "buy" } },
    ]);
  });
});

describe("memoryPlatform", () => {
  it("provides every port and takes overrides", () => {
    const storage = memoryStorage();
    const platform = memoryPlatform({ storage });
    expect(platform.storage).toBe(storage);
    expect(Object.keys(platform).sort()).toEqual([
      "activity",
      "env",
      "locks",
      "relay",
      "storage",
      "track",
    ]);
  });
});
