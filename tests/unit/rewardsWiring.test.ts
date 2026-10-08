import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "../../src/domain/wallet.js";
import { deriveKeypair, deriveRewardsKey } from "../../src/infrastructure/solana/keys.js";
import { fakeApi, type ApiHandler, type FakeApi } from "../../src/testing/index.js";
import { fastKeyDerivation } from "./support/fastKdf.js";
import { FIXTURE_PHRASE } from "./support/walletFixtures.js";

/**
 * Rewards as an app has them: the real store, the real session and the real
 * client, wired by `installMoney`, with only the server stood in for. What
 * each piece does on its own is tested beside it; this holds the wiring.
 */

const PASSWORD = "orbit-cactus-lamp-velvet-quarry";
const MNEMONIC = FIXTURE_PHRASE.join(" ");
const addressAt = (index: number) => deriveKeypair(MNEMONIC, index, "app").publicKey.toBase58();
const MEMBER = deriveRewardsKey(MNEMONIC).publicKey.toBase58();

const STATE = {
  code: "K7M2QX9P",
  codeActive: false,
  invited: 0,
  wasInvited: false,
  memberNumber: 1,
  boostWeeksLeft: 0,
  points: "0",
  week: {
    index: 0,
    endsAt: "2026-10-12T00:00:00.000Z",
    feeMicroUsdc: "0",
    shareBps: 0,
    traders: 0,
  },
};

function makeWallet(): Wallet {
  return {
    createdAt: 1_750_000_000_000,
    derivationScheme: "app",
    funding: { address: addressAt(0), sol: 0, tokens: {} },
    portfolios: [
      {
        id: "acc_1",
        label: "Portfolio 1",
        address: addressAt(1),
        derivationIndex: 1,
        createdAt: 1_750_000_000_000,
        archivedAt: null,
        holdings: [],
      },
    ],
    activity: [],
    watchlist: [],
  };
}

let realKeyDerivation: () => void = () => undefined;
let api: FakeApi | undefined;
let lock: () => void = () => undefined;

beforeEach(() => {
  realKeyDerivation = fastKeyDerivation();
});

afterEach(() => {
  // Locking clears the store's idle timer, which would otherwise outlive the test.
  lock();
  api?.restore();
  api = undefined;
  realKeyDerivation();
});

/** One freshly loaded app with a wallet unlocked in it, and `routes` for a server. */
async function app(routes: Record<string, ApiHandler>) {
  vi.resetModules();
  const { installTestPlatform } = await import("../../src/testing/index.js");
  installTestPlatform();
  const store = await import("../../src/wallet/store.js");
  await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
  lock = store.lock;
  const { installMoney } = await import("../../src/wallet/money.js");
  const { deps } = installMoney({
    hold: async () => () => undefined,
    ownerGone: async () => false,
  });
  const rewards = await import("../../src/wallet/rewards.js");
  api = fakeApi(routes);
  const portfolio = store.getSnapshot()!.portfolios[0];
  return { store, rewards, api, tradeLanded: () => deps.tradeLanded?.("trade-sig", portfolio) };
}

const claims = (calls: FakeApi) => calls.callsTo("/v1/rewards/claims");

describe("rewards, wired for an app", () => {
  it("sends nothing for a wallet that has not joined, whatever it trades", async () => {
    const { store, rewards, api, tradeLanded } = await app({});
    tradeLanded();
    await rewards.claimTrade("other-sig", { derivationIndex: 1 });
    await rewards.claimQueuedTrades();
    expect(await rewards.rewardsState()).toBeNull();
    expect(api.calls).toEqual([]);
    expect(store.getSnapshot()).not.toHaveProperty("rewardClaims");
  });

  it("claims a landed trade as the member and its portfolio once joined, keeps it until it is final, and stops once the wallet is reset", async () => {
    let final = false;
    const { store, rewards, api, tradeLanded } = await app({
      "POST /v1/rewards/join": () => STATE,
      "POST /v1/rewards/claims": () =>
        final
          ? { credited: true, feeMicroUsdc: "120000", state: STATE }
          : new Response(JSON.stringify({ code: "transaction_not_finalized", error: "Not yet." }), {
              status: 422,
            }),
    });
    expect(await rewards.joinRewards()).toEqual({ kind: "joined", state: STATE });
    expect(store.getSnapshot()?.rewardsJoined).toBe(true);

    tradeLanded();
    await vi.waitFor(() => expect(claims(api)).toHaveLength(1));
    expect(claims(api)[0].json).toMatchObject({
      rewardsKey: MEMBER,
      portfolio: addressAt(1),
      transaction: "trade-sig",
    });
    const waiting = [{ signature: "trade-sig", derivationIndex: 1 }];
    await vi.waitFor(() => expect(store.getSnapshot()?.rewardClaims).toEqual(waiting));

    final = true;
    await rewards.claimQueuedTrades();
    expect(claims(api)).toHaveLength(2);
    expect(store.getSnapshot()).not.toHaveProperty("rewardClaims");

    // A reset takes the joining with the wallet: nothing more is claimed for it.
    expect(await store.resetWallet()).toEqual({ ok: true });
    expect(store.getSnapshot()).toBeNull();
    tradeLanded();
    await rewards.claimQueuedTrades();
    expect(claims(api)).toHaveLength(2);
  });
});
