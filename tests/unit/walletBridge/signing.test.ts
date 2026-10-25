import { Keypair, Message, PublicKey, Transaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Wallet } from "../../../src/domain/wallet.js";
import { deriveKeypair } from "../../../src/infrastructure/solana/keys.js";
import type { BridgePins } from "../../../src/infrastructure/solana/walletBridge/pins.js";
import { fastKeyDerivation } from "../support/fastKdf.js";
import { FIXTURE_PHRASE } from "../support/walletFixtures.js";

const PASSWORD = "orbit-cactus-lamp-velvet-quarry";
const MNEMONIC = FIXTURE_PHRASE.join(" ");
const key = (index: number) => deriveKeypair(MNEMONIC, index, "app");
const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const VALIDATOR = "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const PINS: BridgePins = {
  orderbookProgram: new PublicKey("BrUoDsreaeXWypVxh6LoGseqwB4TZVJZBxvhfxXprvwP"),
  rollupUrl: "https://mainnet-tee.magicblock.app",
  rollupValidator: new PublicKey(VALIDATOR),
  usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  custodyAuthority: null,
  marketIds: [0],
  privateBalance: true,
};

function makeWallet(): Wallet {
  const portfolio = (index: number, archivedAt: number | null) => ({
    id: `acc_${index}`,
    label: `Portfolio ${index}`,
    address: key(index).publicKey.toBase58(),
    derivationIndex: index,
    createdAt: 1_750_000_000_000,
    archivedAt,
    holdings: [],
  });
  return {
    createdAt: 1_750_000_000_000,
    derivationScheme: "app",
    funding: { address: key(0).publicKey.toBase58(), sol: 0, tokens: {} },
    portfolios: [portfolio(1, null), portfolio(2, 1_750_000_001_000)],
    activity: [],
    watchlist: [],
  };
}

const healthyRollup = (async (_url: RequestInfo | URL, init?: RequestInit) => {
  const { method } = JSON.parse(String(init?.body)) as { method: string };
  const result =
    method === "getIdentity"
      ? { identity: VALIDATOR }
      : method === "getAccountInfo"
        ? { value: { owner: TOKEN_PROGRAM } }
        : { value: true };
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
}) as typeof fetch;

let realKeyDerivation: () => void = () => undefined;
let lock: () => void = () => undefined;

beforeEach(() => {
  realKeyDerivation = fastKeyDerivation();
});

afterEach(() => {
  // Locking clears the store's idle timer, which would otherwise outlive the test.
  lock();
  realKeyDerivation();
});

/** One freshly loaded app with the wallet unlocked in it. */
async function app() {
  vi.resetModules();
  const { installTestPlatform } = await import("../../../src/testing/index.js");
  installTestPlatform();
  const store = await import("../../../src/wallet/store.js");
  await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
  lock = store.lock;
  const bridge = await import("../../../src/wallet/bridge.js");
  const application = await import("../../../src/application/walletBridge.js");
  return { store, bridge, application };
}

const PORTFOLIO = { address: key(1).publicKey.toBase58(), derivationIndex: 1 };

/** A message of the one shape the wallet signs without a custody pinned: a device change for `owner`. */
async function deviceChange(owner: PublicKey) {
  const { setOrderKeys } =
    await import("../../../src/infrastructure/solana/walletBridge/expected.js");
  const transaction = new Transaction();
  transaction.feePayer = owner;
  transaction.recentBlockhash = BLOCKHASH;
  transaction.add(
    setOrderKeys(
      PINS,
      owner,
      [1, 2, 3, 4].map((at) => Keypair.fromSeed(new Uint8Array(32).fill(at)).publicKey),
    ),
  );
  return transaction;
}

describe("signing for the bridge", () => {
  it("reads a request, signs its exact bytes with the account's own key, and the signature verifies", async () => {
    const { bridge, application } = await app();
    const owner = key(1).publicKey;
    const transaction = await deviceChange(owner);
    const message = Uint8Array.from(transaction.serializeMessage());

    const ports = bridge.bridgePorts({
      pins: PINS,
      guard: {
        fetch: healthyRollup,
        solana: { genesisHash: async () => "", isBlockhashValid: async () => false },
        timeoutMs: 1_000,
      },
    });
    const review = await application.reviewRequest(
      ports,
      { type: "signTransaction", network: "rollup", message },
      owner.toBase58(),
    );
    expect(review).toMatchObject({
      ok: true,
      reviewed: { decoded: { kind: "setOrderKeys", owner: owner.toBase58() } },
    });

    const signed = bridge.signForBridge({
      message,
      account: PORTFOLIO,
      shownGeneration: bridge.shownGeneration(),
      safeAcrossTabs: true,
    });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const attached = Transaction.populate(Message.from(Buffer.from(message)));
    attached.addSignature(owner, Buffer.from(signed.signature));
    expect(attached.verifySignatures()).toBe(true);
    expect(attached.signatures[0].signature?.length).toBe(64);
  });

  it("signs nothing when the wallet locked and was unlocked again after the request was shown", async () => {
    const { store, bridge } = await app();
    const message = Uint8Array.from((await deviceChange(key(1).publicKey)).serializeMessage());
    const shown = bridge.shownGeneration();

    store.lock();
    expect(await store.unlock(PASSWORD)).toBeNull();

    expect(
      bridge.signForBridge({
        message,
        account: PORTFOLIO,
        shownGeneration: shown,
        safeAcrossTabs: true,
      }),
    ).toEqual({ ok: false, refusal: "locked" });
    expect(
      bridge.signForBridge({
        message,
        account: PORTFOLIO,
        shownGeneration: bridge.shownGeneration(),
        safeAcrossTabs: true,
      }).ok,
    ).toBe(true);
  });

  it("signs nothing while the wallet is locked", async () => {
    const { store, bridge } = await app();
    const message = Uint8Array.from((await deviceChange(key(1).publicKey)).serializeMessage());
    const shown = bridge.shownGeneration();
    store.lock();
    expect(
      bridge.signForBridge({
        message,
        account: PORTFOLIO,
        shownGeneration: shown,
        safeAcrossTabs: true,
      }),
    ).toEqual({ ok: false, refusal: "locked" });
  });

  it("signs nothing in a browser that cannot keep the wallet safe across tabs", async () => {
    const { bridge } = await app();
    expect(
      bridge.signForBridge({
        message: new Uint8Array([1]),
        account: PORTFOLIO,
        shownGeneration: bridge.shownGeneration(),
        safeAcrossTabs: false,
      }),
    ).toEqual({ ok: false, refusal: "unsafeBrowser" });
  });

  it("signs nothing for an account that is archived, unknown, or at another index", async () => {
    const { bridge } = await app();
    const sign = (account: { address: string; derivationIndex: number }) =>
      bridge.signForBridge({
        message: new Uint8Array([1]),
        account,
        shownGeneration: bridge.shownGeneration(),
        safeAcrossTabs: true,
      });
    expect(sign({ address: key(2).publicKey.toBase58(), derivationIndex: 2 })).toEqual({
      ok: false,
      refusal: "notAllowed",
    });
    expect(sign({ address: key(9).publicKey.toBase58(), derivationIndex: 9 })).toEqual({
      ok: false,
      refusal: "notAllowed",
    });
    expect(sign({ address: PORTFOLIO.address, derivationIndex: 5 })).toEqual({
      ok: false,
      refusal: "notAllowed",
    });
  });

  it("signs nothing for an account with an action in progress", async () => {
    const { store, bridge } = await app();
    await store.updateWallet((wallet) => ({
      ...wallet,
      portfolios: wallet.portfolios.map((portfolio) =>
        portfolio.derivationIndex === 1
          ? {
              ...portfolio,
              pendingAction: { status: "reserved", id: "a", at: 0, what: "a send of 5.00 USDC" },
            }
          : portfolio,
      ),
    }));
    expect(
      bridge.signForBridge({
        message: new Uint8Array([1]),
        account: PORTFOLIO,
        shownGeneration: bridge.shownGeneration(),
        safeAcrossTabs: true,
      }),
    ).toEqual({ ok: false, refusal: "pendingAction" });
  });

  it("offers the main wallet and each portfolio that is not archived, and marks the busy one", async () => {
    const { store, application } = await app();
    await store.updateWallet((wallet) => ({
      ...wallet,
      funding: {
        ...wallet.funding,
        pendingAction: { status: "reserved", id: "a", at: 0, what: "a send" },
      },
    }));
    expect(application.bridgeChoices(store.getSnapshot()!)).toEqual([
      expect.objectContaining({ kind: "funding", derivationIndex: 0, selectable: false }),
      expect.objectContaining({ kind: "portfolio", label: "Portfolio 1", selectable: true }),
    ]);
  });
});

describe("reading a request", () => {
  it("refuses a request that is not one of the shapes, and one for the wrong network", async () => {
    const { bridge, application } = await app();
    const owner = key(1).publicKey;
    const message = Uint8Array.from((await deviceChange(owner)).serializeMessage());
    const wrongChain = bridge.bridgePorts({
      pins: PINS,
      guard: {
        fetch: (async () =>
          new Response(
            JSON.stringify({ jsonrpc: "2.0", id: 1, result: { identity: "someoneElse" } }),
          )) as typeof fetch,
        solana: { genesisHash: async () => "", isBlockhashValid: async () => false },
        timeoutMs: 1_000,
      },
    });
    expect(
      await application.reviewRequest(
        wrongChain,
        { type: "signTransaction", network: "rollup", message },
        owner.toBase58(),
      ),
    ).toEqual({ ok: false, refusal: "wrongNetwork" });
    expect(
      await application.reviewRequest(
        wrongChain,
        { type: "signTransaction", network: "solana", message },
        owner.toBase58(),
      ),
    ).toEqual({ ok: false, refusal: "notAllowed" });
    expect(
      await application.reviewRequest(
        wrongChain,
        { type: "signTransaction", network: "rollup", message: message.subarray(0, 40) },
        owner.toBase58(),
      ),
    ).toMatchObject({ ok: false });
  });

  it("asks the network again for a check older than a minute", async () => {
    const { application } = await app();
    const reviewed = {
      decoded: { type: "transaction" as const, network: "rollup" as const },
      checkedAtMs: 1_000,
    } as never;
    expect(application.needsNetworkCheck(reviewed, 1_000 + 60_000)).toBe(false);
    expect(application.needsNetworkCheck(reviewed, 1_000 + 60_001)).toBe(true);
  });
});
