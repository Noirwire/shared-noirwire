import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from "@solana/web3.js";
import { deriveKeypair } from "../../src/infrastructure/solana/keys.js";
import type { Wallet } from "../../src/domain/wallet.js";
import { newVaultKey, open, seal, vaultKeyFor, type Envelope } from "../../src/wallet/keystore.js";
import { STORAGE_KEY, toStored } from "../../src/wallet/types.js";
import { fakeDevice, type FakeDevice } from "./support/device.js";
import { FIXTURE_PHRASE } from "./support/walletFixtures.js";

/**
 * One action at a time per portfolio, reserved before anything is signed,
 * and released only on chain evidence or on the user's word. These hold it
 * to what people really do: tap Confirm twice, confirm in two tabs, close or
 * reload the page mid-way, lock and unlock.
 */

const PASSWORD = "orbit-cactus-lamp-velvet-quarry";
const MNEMONIC = FIXTURE_PHRASE.join(" ");
const keyAt = (index: number) => deriveKeypair(MNEMONIC, index, "app");
const addressAt = (index: number) => keyAt(index).publicKey.toBase58();
const LAST_VALID = 1_000;
const PORTFOLIO = addressAt(1);

function makeWallet(): Wallet {
  const portfolio = (index: number) => ({
    id: `acc_${index}`,
    label: `Portfolio ${index}`,
    address: addressAt(index),
    derivationIndex: index,
    createdAt: 1_750_000_000_000,
    archivedAt: null,
    holdings: [{ symbol: "USDC", amount: 50, cost: 50 }],
  });
  return {
    createdAt: 1_750_000_000_000,
    derivationScheme: "app",
    funding: { address: addressAt(0), sol: 0, tokens: {} },
    portfolios: [portfolio(1), portfolio(2)],
    activity: [],
    watchlist: [],
  };
}

/** What the chain says, shared by every tab: they all ask the same chain. */
let status: "confirmed" | "failed" | "absent";
let blockHeight: number;
let blockhashValid: boolean;
/** The chain the connection serves: the one the app is built for, or another one. */
let genesisHash: string;

/**
 * A freshly loaded tab: the store and everything built on it are imported
 * anew, so nothing is carried over in memory. The vault and the locks of the
 * device are shared, as a browser's are between its tabs. A reservation
 * whose lock nobody holds is one whose tab is gone.
 */
let window: FakeDevice;
let held: Set<string>;

async function openTab() {
  vi.resetModules();
  const { installPlatform } = await import("../../src/platform.js");
  installPlatform(window.platform());
  const store = await import("../../src/wallet/store.js");
  const { wirePending } = await import("./support/pendingWiring.js");
  const pending = wirePending(held);
  const signing = await import("../../src/infrastructure/solana/signerAccounts.js");
  const { connection } = await import("../../src/infrastructure/solana/client.js");
  const { expectedGenesisHash } = await import("../../src/infrastructure/solana/config.js");
  vi.spyOn(connection, "getGenesisHash").mockImplementation(async () =>
    genesisHash === "expected" ? expectedGenesisHash() : genesisHash,
  );
  const { UnknownOutcomeError } = await import("../../src/infrastructure/solana/swap/types.js");
  vi.spyOn(connection, "getBlockHeight").mockImplementation(async () => blockHeight);
  vi.spyOn(connection, "isBlockhashValid").mockImplementation(async () => ({
    context: { slot: 1 },
    value: blockhashValid,
  }));
  vi.spyOn(connection, "getSignatureStatus").mockImplementation(async () => ({
    context: { slot: 1 },
    value:
      status === "absent"
        ? null
        : {
            slot: 1,
            confirmations: 1,
            err: status === "failed" ? { InstructionError: [0, "Custom"] } : null,
            confirmationStatus: "confirmed",
          },
  }));
  return { store, pending, signing, UnknownOutcomeError };
}

const SEND = {
  kind: "send" as const,
  symbol: "USDC",
  amount: 5,
  usd: 5,
  counterparty: addressAt(9),
};

/** A transaction the portfolio pays for itself, as the app signs one. */
function ownTransaction() {
  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: keyAt(1).publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [
        SystemProgram.transfer({
          fromPubkey: keyAt(1).publicKey,
          toPubkey: keyAt(9).publicKey,
          lamports: 1,
        }),
      ],
    }).compileToLegacyMessage(),
  );
}

describe("reserving an action", () => {
  const tabs: Awaited<ReturnType<typeof openTab>>[] = [];

  async function tab() {
    const opened = await openTab();
    tabs.push(opened);
    return opened;
  }

  async function walletTab() {
    const first = await tab();
    await first.store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
    return first;
  }

  beforeEach(() => {
    window = fakeDevice();
    held = new Set();
    status = "absent";
    blockHeight = LAST_VALID - 10;
    blockhashValid = true;
    genesisHash = "expected";
  });

  afterEach(() => {
    tabs.splice(0).forEach((opened) => opened.store.lock());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("lets only one of two quick confirms in one tab through", async () => {
    const { pending } = await walletTab();
    const [one, two] = await Promise.all([
      pending.reserve("acc_1", PORTFOLIO, "a send of 5.00 USDC", SEND),
      pending.reserve("acc_1", PORTFOLIO, "a send of 5.00 USDC", SEND),
    ]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    expect(pending.pendingFor("acc_1")).toMatchObject({ status: "reserved" });
    // Another portfolio is not held back by it.
    expect(await pending.reserve("acc_2", addressAt(2), "a send")).not.toBeNull();
  });

  it("lets only one of two confirms in two tabs through", async () => {
    const first = await walletTab();
    const second = await tab();
    expect(await second.store.unlock(PASSWORD)).toBeNull();
    const [one, two] = await Promise.all([
      first.pending.reserve("acc_1", PORTFOLIO, "a send of 5.00 USDC", SEND),
      second.pending.reserve("acc_1", PORTFOLIO, "a send of 5.00 USDC", SEND),
    ]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    // Neither tab can start another while it stands.
    expect(await first.pending.reserve("acc_1", PORTFOLIO, "again")).toBeNull();
    expect(await second.pending.reserve("acc_1", PORTFOLIO, "again")).toBeNull();
  });

  it("is removed when the action completes, or fails having sent nothing", async () => {
    const { pending } = await walletTab();
    const done = await pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    await done!.finish();
    expect(pending.pendingFor("acc_1")).toBeUndefined();

    const refused = await pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    await refused!.finish(new Error("This transaction would also move another asset. Not signed."));
    expect(pending.pendingFor("acc_1")).toBeUndefined();
  });

  it("stays, as unknown, when the outcome is unknown, until the chain settles it", async () => {
    const { pending, UnknownOutcomeError, store } = await walletTab();
    const sending = await pending.reserve("acc_1", PORTFOLIO, "a send of 5.00 USDC", SEND);
    await sending!.finish(new UnknownOutcomeError("the-signature", LAST_VALID));
    expect(pending.pendingFor("acc_1")).toMatchObject({
      status: "unknown",
      signature: "the-signature",
      lastValidBlockHeight: LAST_VALID,
    });
    expect(await pending.reserve("acc_1", PORTFOLIO, "again")).toBeNull();
    expect(await pending.settlePending("acc_1")).toBe("pending");

    status = "confirmed";
    expect(await pending.settlePending("acc_1")).toBe("landed");
    expect(pending.pendingFor("acc_1")).toBeUndefined();
    expect(store.getSnapshot()?.activity).toMatchObject([{ portfolioId: "acc_1", ...SEND }]);
  });

  it("records a signed transaction before it can be sent, and refuses to let it go unrecorded", async () => {
    const { pending, signing } = await walletTab();
    const sending = await pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    const transaction = ownTransaction();
    await signing.signForSending(transaction, keyAt(1), () => true, LAST_VALID);
    expect(pending.pendingFor("acc_1")).toMatchObject({
      status: "unknown",
      blockhash: transaction.message.recentBlockhash,
      lastValidBlockHeight: LAST_VALID,
    });
    expect(pending.pendingFor("acc_1")?.signature).toBeTruthy();

    await sending!.finish();

    // A wallet that locked meanwhile cannot write the record: nothing may be sent.
    const again = await pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    expect(again).not.toBeNull();
    tabs[0].store.lock();
    await expect(
      signing.signForSending(ownTransaction(), keyAt(1), () => true, LAST_VALID),
    ).rejects.toMatchObject({ code: "notRecorded" });
  });

  it("refuses to send what a key with no reservation signed, so no payment goes unrecorded", async () => {
    const { signing, pending } = await walletTab();
    await expect(
      signing.signForSending(ownTransaction(), keyAt(1), () => true, LAST_VALID),
    ).rejects.toMatchObject({ code: "notRecorded" });
    expect(pending.pendingFor("acc_1")).toBeUndefined();
  });

  it("signs nothing when the connection serves another chain", async () => {
    const { signing, pending } = await walletTab();
    const sending = await pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    genesisHash = "another-chain";
    const transaction = ownTransaction();
    await expect(
      signing.signForSending(transaction, keyAt(1), () => true, LAST_VALID),
    ).rejects.toMatchObject({ code: "wrongNetwork" });
    expect(transaction.signatures.every((signature) => signature.every((byte) => byte === 0))).toBe(
      true,
    );
    expect(pending.pendingFor("acc_1")).toMatchObject({ status: "reserved" });
    await sending!.finish(new Error("refused"));
  });

  it("refuses a second money wiring in the same app", async () => {
    await walletTab();
    const { installMoney } = await import("../../src/wallet/money.js");
    expect(() =>
      installMoney({ hold: async () => () => undefined, ownerGone: async () => null }),
    ).toThrow(/already wired/);
  });

  it("survives the page being closed between reserving and signing, and is then released", async () => {
    const first = await walletTab();
    // The tab dies with its reservation written and nothing signed: its
    // lock goes with it. That is a reservation in the record whose lock is free.
    await first.store.updateWallet((wallet) => ({
      ...wallet,
      portfolios: wallet.portfolios.map((portfolio) =>
        portfolio.id === "acc_1"
          ? {
              ...portfolio,
              pendingAction: { status: "reserved", id: "act_dead", at: 1, what: "a send" },
            }
          : portfolio,
      ),
    }));
    const reloaded = await tab();
    expect(await reloaded.store.unlock(PASSWORD)).toBeNull();
    expect(reloaded.pending.pendingFor("acc_1")).toMatchObject({ status: "reserved" });
    expect(await reloaded.pending.settlePending("acc_1")).toBe("expired");
    expect(reloaded.pending.pendingFor("acc_1")).toBeUndefined();
  });

  it("is not released by another tab while the tab that made it is still at work", async () => {
    const first = await walletTab();
    const reservation = await first.pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    const second = await tab();
    expect(await second.store.unlock(PASSWORD)).toBeNull();
    expect(await second.pending.settlePending("acc_1")).toBe("pending");
    expect(await second.pending.reserve("acc_1", PORTFOLIO, "again")).toBeNull();
    await reservation!.finish();
    expect(await second.pending.settlePending("acc_1")).toBe("none");
  });

  it("after a crash between signing and sending, waits for the chain to show it cannot land", async () => {
    const first = await walletTab();
    await first.pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    await first.signing.signForSending(ownTransaction(), keyAt(1), () => true);
    // The page is reloaded before the transaction is sent or answered.
    const reloaded = await tab();
    expect(await reloaded.store.unlock(PASSWORD)).toBeNull();
    expect(await reloaded.pending.settlePending("acc_1")).toBe("pending");
    blockhashValid = false;
    expect(await reloaded.pending.settlePending("acc_1")).toBe("expired");
  });

  it("is still there after a lock and unlock", async () => {
    const { store, pending, UnknownOutcomeError } = await walletTab();
    const sending = await pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    await sending!.finish(new UnknownOutcomeError("the-signature", LAST_VALID));
    store.lock();
    expect(await store.unlock(PASSWORD)).toBeNull();
    expect(await pending.settlePending("acc_1")).toBe("pending");
  });

  it("is never released by time, only by the user once the chain has nothing to go on", async () => {
    const { pending, UnknownOutcomeError } = await walletTab();
    const sending = await pending.reserve("acc_1", PORTFOLIO, "a send", SEND);
    // Sent by someone else's fee payer, whose signature never came back, and
    // nothing recorded of when it expires.
    await sending!.finish(new UnknownOutcomeError());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    expect(await pending.settlePending("acc_1")).toBe("unknown");
    expect(pending.pendingFor("acc_1")).toBeDefined();
    vi.useRealTimers();

    const id = pending.pendingFor("acc_1")!.id;
    await pending.clearPending("acc_1", "some-other-id");
    expect(pending.pendingFor("acc_1")).toBeDefined();
    await pending.clearPending("acc_1", id);
    expect(pending.pendingFor("acc_1")).toBeUndefined();
  });

  it("holds the funding wallet to one move of money at a time, apart from the portfolios", async () => {
    const first = await walletTab();
    const second = await tab();
    expect(await second.store.unlock(PASSWORD)).toBeNull();
    const funder = addressAt(0);
    const [one, two] = await Promise.all([
      first.pending.reserve(first.pending.FUNDING, funder, "a private transfer"),
      second.pending.reserve(second.pending.FUNDING, funder, "a private transfer"),
    ]);
    expect([one, two].filter(Boolean)).toHaveLength(1);
    // A portfolio's own actions are not held back by it.
    expect(await first.pending.reserve("acc_1", PORTFOLIO, "a send")).not.toBeNull();
  });

  it("records the funding wallet's signed transfer, and keeps an accepted one until the chain shows it", async () => {
    const { pending, signing, store } = await walletTab();
    const funding = await pending.reserve(pending.FUNDING, addressAt(0), "a private transfer");
    const transfer = new VersionedTransaction(
      new TransactionMessage({
        payerKey: keyAt(0).publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: [
          SystemProgram.transfer({
            fromPubkey: keyAt(0).publicKey,
            toPubkey: keyAt(9).publicKey,
            lamports: 1,
          }),
        ],
      }).compileToLegacyMessage(),
    );
    await signing.signForSending(transfer, keyAt(0), () => true);
    expect(store.getSnapshot()?.funding.pendingAction).toMatchObject({
      blockhash: transfer.message.recentBlockhash,
    });

    // The service accepted it. Money arriving later is the queue's doing; the
    // reservation stays until the transaction itself is seen on chain.
    await funding!.submitted("enqueue-signature");
    expect(pending.pendingFor(pending.FUNDING)).toMatchObject({
      status: "unknown",
      signature: "enqueue-signature",
    });
    expect(await pending.reserve(pending.FUNDING, addressAt(0), "again")).toBeNull();
    expect(await pending.settlePending(pending.FUNDING)).toBe("pending");

    // A reload changes nothing.
    const reloaded = await tab();
    expect(await reloaded.store.unlock(PASSWORD)).toBeNull();
    expect(await reloaded.pending.settlePending(reloaded.pending.FUNDING)).toBe("pending");

    status = "confirmed";
    expect(await reloaded.pending.settlePending(reloaded.pending.FUNDING)).toBe("landed");
    expect(reloaded.pending.pendingFor(reloaded.pending.FUNDING)).toBeUndefined();
    // A funding move writes no activity entry of its own here: arrival does.
    expect(reloaded.store.getSnapshot()?.activity).toHaveLength(0);
  });

  it("keeps an unknown direct funding move until the chain settles it", async () => {
    const { pending, UnknownOutcomeError } = await walletTab();
    const funding = await pending.reserve(pending.FUNDING, addressAt(0), "moving 5.00 USDC");
    await funding!.finish(new UnknownOutcomeError("deposit-signature", LAST_VALID));
    expect(await pending.settlePending(pending.FUNDING)).toBe("pending");
    blockHeight = LAST_VALID + 1;
    expect(await pending.settlePending(pending.FUNDING)).toBe("expired");
    expect(await pending.reserve(pending.FUNDING, addressAt(0), "again")).not.toBeNull();
  });
});

/**
 * A wallet record written by the build before the pending states took the
 * shared package's names: its pending entries carry `state` ("reserved" or
 * "submitted") and no `status`. They are read, held and settled as before.
 */
describe("a pending action stored by the previous build", () => {
  const tabs: Awaited<ReturnType<typeof openTab>>[] = [];

  /** The previous build's stored wallet, with `pending` on the first portfolio. */
  async function storePrevious(
    pending: Record<string, unknown>,
    funding?: Record<string, unknown>,
  ) {
    const { accounts, ...wallet } = toStored(makeWallet()) as unknown as {
      accounts: Record<string, unknown>[];
      funding: Record<string, unknown>;
    };
    const record = {
      rev: 1,
      phrase: FIXTURE_PHRASE,
      wallet: {
        ...wallet,
        funding: funding ? { ...wallet.funding, pendingAction: funding } : wallet.funding,
        accounts: accounts.map((account, index) =>
          index === 0 ? { ...account, pendingAction: pending } : account,
        ),
      },
    };
    const envelope = await seal(await newVaultKey(PASSWORD), JSON.stringify(record));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    const opened = await openTab();
    tabs.push(opened);
    expect(await opened.store.unlock(PASSWORD)).toBeNull();
    return opened;
  }

  async function stored() {
    const envelope = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as Envelope;
    return JSON.parse((await open(await vaultKeyFor(envelope, PASSWORD), envelope))!) as {
      wallet: { accounts: { pendingAction?: Record<string, unknown> }[] };
    };
  }

  beforeEach(() => {
    window = fakeDevice();
    held = new Set();
    status = "absent";
    blockHeight = LAST_VALID - 10;
    blockhashValid = true;
    genesisHash = "expected";
  });

  afterEach(() => {
    tabs.splice(0).forEach((opened) => opened.store.lock());
    vi.restoreAllMocks();
  });

  it("reads a sent one with an unknown outcome, holds the portfolio, and settles it as landed", async () => {
    const { pending, store } = await storePrevious({
      state: "submitted",
      id: "act_old",
      at: 1,
      what: "a send of 5.00 USDC",
      signature: "old-signature",
      lastValidBlockHeight: LAST_VALID,
      activity: SEND,
    });
    expect(pending.pendingFor("acc_1")).toMatchObject({
      status: "submitted",
      signature: "old-signature",
    });
    expect(await pending.reserve("acc_1", PORTFOLIO, "again")).toBeNull();
    expect(await pending.settlePending("acc_1")).toBe("pending");

    status = "confirmed";
    expect(await pending.settlePending("acc_1")).toBe("landed");
    expect(pending.pendingFor("acc_1")).toBeUndefined();
    expect(store.getSnapshot()?.activity).toMatchObject([{ portfolioId: "acc_1", ...SEND }]);
  });

  it("reads one signed and not yet sent when the page closed, and settles it as expired", async () => {
    const { pending } = await storePrevious({
      state: "reserved",
      id: "act_old",
      at: 1,
      what: "a send",
      blockhash: "old-blockhash",
    });
    expect(pending.pendingFor("acc_1")).toMatchObject({ status: "unknown" });
    expect(await pending.settlePending("acc_1")).toBe("pending");
    blockhashValid = false;
    expect(await pending.settlePending("acc_1")).toBe("expired");
    expect(pending.pendingFor("acc_1")).toBeUndefined();
  });

  it("reads one reserved with nothing signed and releases it once its tab is gone", async () => {
    const { pending } = await storePrevious({
      state: "reserved",
      id: "act_old",
      at: 1,
      what: "a send",
    });
    expect(pending.pendingFor("acc_1")).toMatchObject({ status: "reserved" });
    expect(await pending.settlePending("acc_1")).toBe("expired");
  });

  it("reads one with nothing to settle it by, and lets only the user clear it", async () => {
    const { pending } = await storePrevious({
      state: "submitted",
      id: "act_old",
      at: 1,
      what: "a send",
    });
    expect(pending.pendingFor("acc_1")).toMatchObject({ status: "unknown" });
    expect(await pending.settlePending("acc_1")).toBe("unknown");
    await pending.clearPending("acc_1", "act_old");
    expect(pending.pendingFor("acc_1")).toBeUndefined();
  });

  it("refuses a user clear while there is a block height to settle it by", async () => {
    const { pending } = await storePrevious({
      state: "submitted",
      id: "act_old",
      at: 1,
      what: "a send",
      lastValidBlockHeight: LAST_VALID,
    });
    await pending.clearPending("acc_1", "act_old");
    expect(pending.pendingFor("acc_1")).toMatchObject({ id: "act_old" });
  });

  it("reads the funding wallet's accepted private transfer and keeps it until the chain shows it", async () => {
    const { pending } = await storePrevious(
      { state: "reserved", id: "act_none", at: 1, what: "a send" },
      {
        state: "submitted",
        id: "act_fund",
        at: 1,
        what: "a private transfer",
        signature: "enqueue-signature",
        blockhash: "old-blockhash",
      },
    );
    expect(await pending.reserve(pending.FUNDING, addressAt(0), "again")).toBeNull();
    expect(await pending.settlePending(pending.FUNDING)).toBe("pending");
    status = "confirmed";
    expect(await pending.settlePending(pending.FUNDING)).toBe("landed");
  });

  it("keeps writing the field the previous build reads, next to the new one", async () => {
    const { pending } = await storePrevious({
      state: "submitted",
      id: "act_old",
      at: 1,
      what: "a send",
      signature: "old-signature",
    });
    // Any write re-seals the record: the entry goes back with `state` intact.
    await tabs[0].store.updateWallet((wallet) => ({ ...wallet, watchlist: ["SPYx"] }));
    expect((await stored()).wallet.accounts[0].pendingAction).toMatchObject({
      state: "submitted",
      status: "unknown",
      signature: "old-signature",
    });
    expect(pending.pendingFor("acc_1")).toMatchObject({ status: "unknown" });
  });
});
