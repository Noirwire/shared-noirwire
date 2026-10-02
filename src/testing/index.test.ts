import { describe, expect, it, vi } from "vitest";
import type { Locks } from "../platform.js";
import { manualActivity, memoryPlatform, memoryVault, recordingTrack, testEnv } from "./index.js";

const increment = (current: string | null) => ({ write: String(Number(current ?? "0") + 1) });

describe("memoryVault", () => {
  it("reads what an update wrote, and removes on null", async () => {
    const vault = memoryVault({ seeded: "1" });
    expect(await vault.read("seeded")).toEqual({ ok: true, value: "1" });
    expect(await vault.update("wallet", () => ({ write: "sealed" }))).toEqual({
      persisted: true,
      value: "sealed",
    });
    expect(await vault.read("wallet")).toEqual({ ok: true, value: "sealed" });
    await vault.update("wallet", () => ({ write: null }));
    expect(await vault.read("wallet")).toEqual({ ok: true, value: null });
  });

  it("reports a kept value as not persisted, with what is stored", async () => {
    const vault = memoryVault({ wallet: "sealed" });
    expect(await vault.update("wallet", () => ({ keep: true }))).toEqual({
      persisted: false,
      reason: "kept",
      value: "sealed",
    });
  });

  it("reports failure instead of throwing while unavailable", async () => {
    const vault = memoryVault({ wallet: "sealed" });
    vault.unavailable = true;
    expect(await vault.read("wallet")).toEqual({ ok: false });
    expect(await vault.update("wallet", increment)).toEqual({ persisted: false, reason: "failed" });
    vault.unavailable = false;
    expect(await vault.read("wallet")).toEqual({ ok: true, value: "sealed" });
  });

  it("loses no update when many run at once", async () => {
    const vault = memoryVault();
    await Promise.all(Array.from({ length: 25 }, () => vault.update("count", increment)));
    expect(await vault.read("count")).toEqual({ ok: true, value: "25" });
  });

  it("would lose updates without the lock, which is what the lock is for", async () => {
    const noLock: Locks = { withLock: (_name, fn) => fn() };
    const vault = memoryVault({}, noLock);
    await Promise.all(Array.from({ length: 25 }, () => vault.update("count", increment)));
    expect(await vault.read("count")).not.toEqual({ ok: true, value: "25" });
  });

  it("tells subscribers of persisted changes, here and from elsewhere, and of nothing else", async () => {
    const vault = memoryVault();
    const onChange = vi.fn();
    const unsubscribe = vault.subscribe(onChange);
    await vault.update("pending", () => ({ write: "{}" }));
    await vault.update("pending", () => ({ keep: true }));
    vault.writeFromElsewhere("wallet", "sealed");
    unsubscribe();
    await vault.update("pending", () => ({ write: null }));
    expect(onChange.mock.calls).toEqual([["pending"], ["wallet"]]);
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
    track("trade_placed", { side: "buy" });
    expect(events).toEqual([
      { event: "wallet_created" },
      { event: "trade_placed", props: { side: "buy" } },
    ]);
  });

  it("accepts only events and values from the closed list", () => {
    const { track } = recordingTrack();
    // @ts-expect-error an event that is not on the list
    track("address_seen", { side: "buy" });
    // @ts-expect-error a free-form string where a closed union is required
    track("trade_placed", { side: "5aqYNsJsmRuasaFMMWAF2s94r1bTuXZC46A6Ro9C82GY" });
    // @ts-expect-error a field the event does not carry
    track("send_failed", { reason: "network", address: "5aqY" });
    // @ts-expect-error props missing for an event that has fields
    track("trade_placed");
  });
});

describe("memoryPlatform", () => {
  it("provides every port, sharing one lock between the vault and the app", () => {
    const platform = memoryPlatform();
    expect(Object.keys(platform).sort()).toEqual(["activity", "env", "locks", "track", "vault"]);
  });
});
