import { describe, expect, it } from "vitest";
import { memoryVault } from "../testing/index.js";
import {
  PENDING_ACTIONS_KEY,
  readPendingAction,
  recordPendingEvent,
  reserveIntent,
} from "./pendingStore.js";

describe("reserveIntent", () => {
  it("reserves an intent with nothing pending, and stores it", async () => {
    const vault = memoryVault();
    expect(await reserveIntent(vault, "portfolio-1")).toBe("reserved");
    expect(await readPendingAction(vault, "portfolio-1")).toEqual({ status: "reserved" });
  });

  it("lets exactly one of two simultaneous confirms through", async () => {
    const vault = memoryVault();
    const outcomes = await Promise.all([
      reserveIntent(vault, "portfolio-1"),
      reserveIntent(vault, "portfolio-1"),
    ]);
    expect(outcomes.sort()).toEqual(["busy", "reserved"]);
  });

  it("keeps intents apart", async () => {
    const vault = memoryVault();
    await reserveIntent(vault, "portfolio-1");
    expect(await reserveIntent(vault, "portfolio-2")).toBe("reserved");
  });

  it("is busy while the last action is submitted or unknown", async () => {
    const vault = memoryVault();
    await reserveIntent(vault, "a");
    await recordPendingEvent(vault, "a", {
      type: "submitted",
      signature: "sig",
      lastValidBlockHeight: 500,
    });
    expect(await reserveIntent(vault, "a")).toBe("busy");
    await recordPendingEvent(vault, "a", { type: "outcomeUnknown" });
    expect(await reserveIntent(vault, "a")).toBe("busy");
  });

  it("refuses to sign when the reservation cannot be stored", async () => {
    const vault = memoryVault();
    vault.unavailable = true;
    expect(await reserveIntent(vault, "a")).toBe("unavailable");
  });

  it("fails closed on a stored record it cannot read", async () => {
    for (const stored of [
      "not json",
      "[]",
      '{"a":{"status":"gone"}}',
      '{"a":{"status":"submitted"}}',
    ]) {
      const vault = memoryVault({ [PENDING_ACTIONS_KEY]: stored });
      expect(await reserveIntent(vault, "b")).toBe("unavailable");
      expect(await readPendingAction(vault, "b")).toBeNull();
    }
  });
});

describe("recordPendingEvent", () => {
  it("reports the stored state when an event does not apply", async () => {
    const vault = memoryVault();
    expect(await recordPendingEvent(vault, "a", { type: "acknowledged" })).toEqual({
      recorded: false,
      reason: "refused",
      pending: { status: "none" },
    });
  });

  it("removes an intent from the record once it is back to none", async () => {
    const vault = memoryVault();
    await reserveIntent(vault, "a");
    await reserveIntent(vault, "b");
    expect(await recordPendingEvent(vault, "a", { type: "releasedBeforeSend" })).toEqual({
      recorded: true,
      pending: { status: "none" },
    });
    expect(await vault.read(PENDING_ACTIONS_KEY)).toEqual({
      ok: true,
      value: JSON.stringify({ b: { status: "reserved" } }),
    });
  });

  it("sees a reservation made in another tab", async () => {
    const vault = memoryVault();
    vault.writeFromElsewhere(PENDING_ACTIONS_KEY, JSON.stringify({ a: { status: "reserved" } }));
    expect(await reserveIntent(vault, "a")).toBe("busy");
  });
});

describe("readPendingAction", () => {
  it("is none for an intent never reserved, and null when the vault cannot be read", async () => {
    const vault = memoryVault();
    expect(await readPendingAction(vault, "a")).toEqual({ status: "none" });
    vault.unavailable = true;
    expect(await readPendingAction(vault, "a")).toBeNull();
  });
});
