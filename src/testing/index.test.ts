import { describe, expect, it, vi } from "vitest";
import type { Locks } from "../platform.js";
import { apiUrl } from "../infrastructure/api.js";
import { authorizedFetch, dropSession } from "../infrastructure/apiSession.js";
import { getPlatform } from "../platform.js";
import {
  fakeApi,
  fakeSession,
  installTestPlatform,
  manualActivity,
  memoryPlatform,
  memorySessionStore,
  memoryVault,
  recordingTrack,
  testEnv,
} from "./index.js";

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

  it("can refuse writes while reads still work, and lists what it holds", async () => {
    const vault = memoryVault({ wallet: "sealed" });
    vault.refuseWrites = true;
    expect(await vault.update("wallet", increment)).toEqual({ persisted: false, reason: "failed" });
    expect(await vault.read("wallet")).toEqual({ ok: true, value: "sealed" });
    expect(vault.keys()).toEqual(["wallet"]);
    expect(vault.peek("wallet")).toBe("sealed");
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
    expect(testEnv()).toEqual({
      network: "devnet",
      referralAccount: null,
      feeBps: 0,
      apiBaseUrl: "https://api.noirwire.test",
    });
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
    expect(Object.keys(platform).sort()).toEqual([
      "activity",
      "env",
      "locks",
      "sessionStore",
      "track",
      "vault",
    ]);
  });
});

describe("memorySessionStore", () => {
  it("holds one value, and gives it up", async () => {
    const store = memorySessionStore();
    expect(await store.get()).toBeNull();
    await store.set("kept");
    expect(await store.get()).toBe("kept");
    expect(store.value).toBe("kept");
    await store.remove();
    expect(await store.get()).toBeNull();
    expect(await memorySessionStore("seeded").get()).toBe("seeded");
  });
});

describe("fakeSession", () => {
  it("hands out one token until that token is turned down or the session is dropped", async () => {
    const session = fakeSession();
    expect(await session.token()).toBe("test-token-1");
    expect(await session.renew("test-token-1")).toBe("test-token-2");
    // A second caller turned down with the old token finds the renewal done.
    expect(await session.renew("test-token-1")).toBe("test-token-2");
    await session.drop();
    expect(await session.token()).toBe("test-token-3");
    expect(session).toMatchObject({ renewals: 2, drops: 1, current: "test-token-3" });
  });
});

describe("installTestPlatform", () => {
  it("installs every port and a session that asks nobody, so a test needs no network", async () => {
    const { platform, session } = installTestPlatform({ env: testEnv({ feeBps: 50 }) });
    expect(getPlatform()).toBe(platform);
    expect(platform.env.feeBps).toBe(50);

    const api = fakeApi({ "/v1/prices": () => ({ prices: {} }) });
    try {
      expect((await authorizedFetch(apiUrl("prices"))).status).toBe(200);
      // No session route was asked: the only request made is the one the test made.
      expect(api.calls.map((call) => call.path)).toEqual(["/v1/prices"]);
      expect(api.calls[0].headers.authorization).toBe("Bearer test-token-1");
      await dropSession();
      expect(session.drops).toBe(1);
    } finally {
      api.restore();
      installTestPlatform();
    }
  });
});

describe("fakeApi", () => {
  it("answers by path, by method and path, and by a path's start, and records what was asked", async () => {
    const api = fakeApi({
      "/v1/prices": () => ({ prices: { NVDAx: 1 } }),
      "POST /v1/relayer": (call) => ({ result: (call.json as { method: string }).method }),
      "GET /v1/relayer": () => ({ available: false }),
      "/v1/jupiter/*": (call) => new Response(call.path, { status: 418 }),
      "/v1/jupiter/lend/*": () => ({ lend: true }),
    });
    try {
      const base = "https://api.noirwire.test";
      expect(await (await fetch(`${base}/v1/prices?fresh=1`)).json()).toEqual({
        prices: { NVDAx: 1 },
      });
      const post = await fetch(`${base}/v1/relayer`, {
        method: "post",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "estimateTransactionFee" }),
      });
      expect(await post.json()).toEqual({ result: "estimateTransactionFee" });
      expect(await (await fetch(`${base}/v1/relayer`)).json()).toEqual({ available: false });
      expect((await fetch(`${base}/v1/jupiter/swap/v2/order`)).status).toBe(418);
      // The longest start that fits answers.
      expect(await (await fetch(`${base}/v1/jupiter/lend/v1/earn/tokens`)).json()).toEqual({
        lend: true,
      });
      // The web's same-origin path is read as it stands.
      await expect(fetch("/api/v1/prices")).rejects.toThrow(
        "fakeApi: no route answers GET /api/v1/prices.",
      );

      expect(api.calls).toHaveLength(6);
      expect(api.callsTo("/v1/relayer").map((call) => call.method)).toEqual(["POST", "GET"]);
      expect(api.calls[0].url.searchParams.get("fresh")).toBe("1");
      expect(api.calls[1]).toMatchObject({
        headers: { "content-type": "application/json" },
        body: '{"method":"estimateTransactionFee"}',
      });
    } finally {
      api.restore();
    }
  });

  it("puts back the fetch that was there", () => {
    const before = globalThis.fetch;
    const api = fakeApi({});
    expect(globalThis.fetch).not.toBe(before);
    api.restore();
    expect(globalThis.fetch).toBe(before);
  });
});
