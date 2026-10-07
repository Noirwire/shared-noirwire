import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "../../src/domain/wallet.js";
import { deriveKeypair } from "../../src/infrastructure/solana/keys.js";
import { fakeApi, type FakeApi } from "../../src/testing/index.js";
import { fakeDevice } from "./support/device.js";
import { fastKeyDerivation } from "./support/fastKdf.js";
import { FIXTURE_PHRASE } from "./support/walletFixtures.js";

const PASSWORD = "orbit-cactus-lamp-velvet-quarry";
const addressAt = (index: number) =>
  deriveKeypair(FIXTURE_PHRASE.join(" "), index, "app").publicKey.toBase58();

const wallet = (): Wallet => ({
  createdAt: 1,
  derivationScheme: "app",
  funding: { address: addressAt(0), sol: 0, tokens: {} },
  portfolios: [],
  activity: [],
  watchlist: [],
});

/** A freshly loaded app over a new device: the store, and the sync status beside it. */
async function loaded() {
  vi.resetModules();
  const { installPlatform } = await import("../../src/platform.js");
  const { keepSessionWith } = await import("../../src/infrastructure/apiSession.js");
  const { fakeSession } = await import("../../src/testing/index.js");
  installPlatform(fakeDevice().platform());
  keepSessionWith(fakeSession());
  const store = await import("../../src/wallet/store.js");
  const profile = await import("../../src/wallet/profile.js");
  return { store, profile };
}

describe("the sync status an app reads", () => {
  let api: FakeApi;
  let realKeyDerivation: () => void;

  beforeEach(() => {
    realKeyDerivation = fastKeyDerivation();
    api = fakeApi({ "GET /v1/profile/config": () => ({ enabled: false }) });
  });

  afterEach(() => {
    api.restore();
    realKeyDerivation();
  });

  it("is nothing until a sync has said, the same object until it changes, and nothing again after a lock", async () => {
    const { store, profile } = await loaded();
    await store.storeNewWallet(wallet(), FIXTURE_PHRASE, PASSWORD);
    let told = 0;
    const stop = profile.subscribeProfileSync(() => (told += 1));
    expect(profile.profileSyncStatus()).toBeNull();

    await profile.syncProfile();
    expect(profile.profileSyncStatus()).toEqual({ kind: "off" });
    expect(profile.profileSyncStatus()).toBe(profile.profileSyncStatus());
    expect(told).toBe(1);

    // A change to the wallet that is none to the status tells its subscribers nothing.
    await store.updateWallet((current) => ({ ...current, watchlist: ["SPYx"] }));
    await profile.syncProfile();
    expect(told).toBe(1);

    store.lock();
    expect(profile.profileSyncStatus()).toBeNull();
    expect(told).toBe(2);

    // Unlocked again, what the last unlock learned is not shown: only a new sync says.
    expect(await store.unlock(PASSWORD)).toBeNull();
    expect(profile.profileSyncStatus()).toBeNull();
    expect(told).toBe(2);
    await profile.syncProfile();
    expect(profile.profileSyncStatus()).toEqual({ kind: "off" });
    expect(told).toBe(3);

    stop();
    store.lock();
    expect(told).toBe(3);
  });
});
