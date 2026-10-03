import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { walletCopy } from "../../src/copy/wallet.js";
import { deriveKeypair } from "../../src/infrastructure/solana/keys.js";
import {
  isEnvelope,
  newVaultKey,
  newVaultKeyWithBits,
  open,
  seal,
  vaultKeyBits,
  vaultKeyFor,
  vaultKeyFromBits,
  type Envelope,
} from "../../src/wallet/keystore.js";
import { type Wallet } from "../../src/domain/wallet.js";
import {
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  toStored,
  type StoredRecord,
} from "../../src/wallet/types.js";
import { fakeDevice, type FakeDevice } from "./support/device.js";
import {
  FIXTURE_PHRASE,
  V8_WALLET_JSON,
  WEB_ENVELOPE_JSON,
  WEB_ENVELOPE_PASSWORD,
} from "./support/walletFixtures.js";

const PASSWORD = "orbit-cactus-lamp-velvet-quarry";
const NEXT = "plum-anvil-harbour-quilt-saffron";
const MNEMONIC = FIXTURE_PHRASE.join(" ");
const addressAt = (index: number) => deriveKeypair(MNEMONIC, index, "app").publicKey.toBase58();
const says = walletCopy.store;

function makeWallet(): Wallet {
  return {
    createdAt: 1_750_000_000_000,
    derivationScheme: "app",
    funding: { address: addressAt(0), sol: 0, tokens: {} },
    portfolios: [
      {
        id: "acc_1",
        label: "Investing",
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

const webEnvelope = (): Envelope => JSON.parse(WEB_ENVELOPE_JSON) as Envelope;

describe("vault key bits", () => {
  it("import to the key unlocking derives, so they open the record", async () => {
    const envelope = await seal(await newVaultKey(PASSWORD), "the record");
    const bits = await vaultKeyBits(envelope, PASSWORD);
    expect(bits).toHaveLength(32);
    expect(await open(await vaultKeyFromBits(envelope, bits), envelope)).toBe("the record");
  });

  it("normalise the password as unlocking does", async () => {
    const envelope = await seal(await newVaultKey("café orbit"), "the record");
    const composed = await vaultKeyBits(envelope, "café orbit");
    const decomposed = await vaultKeyBits(envelope, "café orbit");
    expect(decomposed).toEqual(composed);
  });

  it("refuse when they are not the envelope's key", async () => {
    const envelope = await seal(await newVaultKey(PASSWORD), "the record");
    const other = await vaultKeyBits(envelope, "not-the-password");
    expect(await open(await vaultKeyFromBits(envelope, other), envelope)).toBeNull();
    const random = crypto.getRandomValues(new Uint8Array(32));
    expect(await open(await vaultKeyFromBits(envelope, random), envelope)).toBeNull();
    await expect(vaultKeyFromBits(envelope, new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });

  it("are imported as a key no script can read back", async () => {
    const envelope = await seal(await newVaultKey(PASSWORD), "the record");
    const key = await vaultKeyFromBits(envelope, await vaultKeyBits(envelope, PASSWORD));
    expect(key.key.extractable).toBe(false);
    expect(key).toMatchObject({ salt: envelope.salt, iterations: envelope.iterations });
  });

  it("of a new key are the ones its envelope gives back from the password", async () => {
    const { vaultKey, bits } = await newVaultKeyWithBits(PASSWORD);
    const envelope = await seal(vaultKey, "the record");
    expect(await vaultKeyBits(envelope, PASSWORD)).toEqual(bits);
    expect(await open(await vaultKeyFor(envelope, PASSWORD), envelope)).toBe("the record");
  });

  it("open an envelope the web app sealed, from a differently typed spelling of its password", async () => {
    const envelope = webEnvelope();
    const bits = await vaultKeyBits(envelope, WEB_ENVELOPE_PASSWORD.normalize("NFD"));
    const plaintext = await open(await vaultKeyFromBits(envelope, bits), envelope);
    expect((JSON.parse(plaintext!) as StoredRecord).phrase).toEqual(FIXTURE_PHRASE);
  });
});

let device: FakeDevice;

async function openTab() {
  vi.resetModules();
  const { installPlatform } = await import("../../src/platform.js");
  installPlatform(device.platform());
  return import("../../src/wallet/store.js");
}

function storedEnvelope(): Envelope {
  const parsed: unknown = JSON.parse(device.localStorage.getItem(STORAGE_KEY)!);
  if (!isEnvelope(parsed)) throw new Error("no envelope stored");
  return parsed;
}

async function decryptsWith(password: string) {
  const envelope = storedEnvelope();
  return (await open(await vaultKeyFor(envelope, password), envelope)) !== null;
}

describe("the store with key bits", () => {
  const tabs: Awaited<ReturnType<typeof openTab>>[] = [];

  async function tab() {
    const opened = await openTab();
    tabs.push(opened);
    return opened;
  }

  async function storedWallet() {
    const first = await tab();
    await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
    return first;
  }

  beforeEach(() => {
    device = fakeDevice();
  });

  afterEach(() => {
    tabs.splice(0).forEach((opened) => opened.lock());
  });

  describe("unlocking", () => {
    it("unlocks with the bits the password derives, as the password does", async () => {
      await storedWallet();
      const bits = await vaultKeyBits(storedEnvelope(), PASSWORD);
      const second = await tab();
      expect(await second.unlockWithKeyBits(bits)).toBeNull();
      expect(second.isUnlocked()).toBe(true);
      expect(second.getPhrase()).toEqual(FIXTURE_PHRASE);
      expect(second.getSnapshot()?.portfolios[0].address).toBe(addressAt(1));
    });

    it("refuses bits that do not open the record, and stays locked", async () => {
      await storedWallet();
      const wrong = await vaultKeyBits(storedEnvelope(), "not-the-password");
      const second = await tab();
      expect(await second.unlockWithKeyBits(wrong)).toBe(says.keyRefused);
      expect(await second.unlockWithKeyBits(new Uint8Array(16))).toBe(says.keyRefused);
      expect(second.isUnlocked()).toBe(false);
      expect(second.getPhrase()).toBeNull();
    });

    it("refuses a record whose addresses the phrase does not derive", async () => {
      const vaultKey = await newVaultKey(PASSWORD);
      const wallet = makeWallet();
      const swapped: StoredRecord = {
        rev: 1,
        phrase: FIXTURE_PHRASE,
        wallet: toStored({
          ...wallet,
          portfolios: [{ ...wallet.portfolios[0], address: addressAt(5) }],
        }),
      };
      device.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(await seal(vaultKey, JSON.stringify(swapped))),
      );
      const bits = await vaultKeyBits(storedEnvelope(), PASSWORD);
      const opened = await tab();
      expect(await opened.unlockWithKeyBits(bits)).toBe(says.addressMismatch);
      expect(opened.isUnlocked()).toBe(false);
    });

    it("discards a result that finishes after the wallet was locked", async () => {
      await storedWallet();
      const bits = await vaultKeyBits(storedEnvelope(), PASSWORD);
      const second = await tab();
      const pending = second.unlockWithKeyBits(bits);
      second.lock();
      expect(await pending).toBe(says.interrupted);
      expect(second.isUnlocked()).toBe(false);
      expect(second.getPhrase()).toBeNull();
    });

    it("discards a result that finishes after another tab replaced the wallet", async () => {
      await storedWallet();
      const bits = await vaultKeyBits(storedEnvelope(), PASSWORD);
      const replacement = JSON.stringify(await seal(await newVaultKey("another"), "{}"));
      const second = await tab();
      const pending = second.unlockWithKeyBits(bits);
      device.localStorage.setItem(STORAGE_KEY, replacement);
      expect(await pending).toBe(says.interrupted);
      expect(second.isUnlocked()).toBe(false);
    });

    it("deletes old plain text phrases once unlocked", async () => {
      await storedWallet();
      const bits = await vaultKeyBits(storedEnvelope(), PASSWORD);
      device.localStorage.setItem("noirwire.wallet.v3", JSON.stringify({ phrase: "plain" }));
      const second = await tab();
      expect(await second.unlockWithKeyBits(bits)).toBeNull();
      expect(device.backing.has("noirwire.wallet.v3")).toBe(false);
    });

    it("says there is no wallet, and asks for the password for a wallet in the previous format", async () => {
      const empty = await tab();
      expect(await empty.unlockWithKeyBits(new Uint8Array(32))).toBe(says.noWallet);
      device.localStorage.setItem(LEGACY_STORAGE_KEY, V8_WALLET_JSON);
      const legacy = await tab();
      expect(await legacy.unlockWithKeyBits(new Uint8Array(32))).toBe(says.keyRefused);
    });

    it("opens a record the web app sealed, with bits from its password", async () => {
      device.localStorage.setItem(STORAGE_KEY, WEB_ENVELOPE_JSON);
      const bits = await vaultKeyBits(webEnvelope(), WEB_ENVELOPE_PASSWORD);
      const opened = await tab();
      expect(await opened.unlockWithKeyBits(bits)).toBeNull();
      expect(opened.getPhrase()).toEqual(FIXTURE_PHRASE);
      expect(opened.getSnapshot()?.funding.address).toBe(addressAt(0));
    });
  });

  describe("a password change whose write is reported as failed", () => {
    /**
     * The next vault update reports failure. `lands` says whether it was
     * written all the same, and `thenUnreadable` whether the vault stops
     * answering reads right after, so nothing can be read back.
     */
    function failNextWrite(lands: boolean, thenUnreadable = false) {
      const update = device.vault.update.bind(device.vault);
      vi.spyOn(device.vault, "update").mockImplementationOnce(async (key, change) => {
        if (lands) await update(key, change);
        device.vault.unavailable = thenUnreadable;
        return { persisted: false, reason: "failed" };
      });
    }

    it("reads the record back and says it changed when the write landed", async () => {
      const first = await storedWallet();
      failNextWrite(true);
      expect(await first.changePassword(PASSWORD, NEXT)).toEqual({
        outcome: "changed",
        notice: null,
      });
      expect(await decryptsWith(NEXT)).toBe(true);
      expect(await first.updateWallet((wallet) => ({ ...wallet, watchlist: ["SPYx"] }))).toBe(true);
      expect(await decryptsWith(NEXT)).toBe(true);
    });

    it("reads the record back and says it did not change when the write did not land", async () => {
      const first = await storedWallet();
      failNextWrite(false);
      expect(await first.changePassword(PASSWORD, NEXT)).toEqual({
        outcome: "unchanged",
        reason: says.notSaved,
      });
      expect(await decryptsWith(PASSWORD)).toBe(true);
    });

    it("says it may have changed when nothing can be read back, and holds the next change until it can", async () => {
      const first = await storedWallet();
      failNextWrite(true, true);
      expect(await first.changePassword(PASSWORD, NEXT)).toEqual({
        outcome: "indeterminate",
        reason: says.passwordChangeUnknown,
      });
      expect(says.passwordChangeUnknown).toMatch(
        /new password first; if it does not open, use the old one/,
      );

      const update = vi.spyOn(device.vault, "update");
      update.mockClear();
      expect(await first.changePassword(PASSWORD, "quartz-meadow-lantern-ember-fjord")).toEqual({
        outcome: "indeterminate",
        reason: says.passwordChangeUnknown,
      });
      expect(update).not.toHaveBeenCalled();

      device.vault.unavailable = false;
      expect(await first.changePassword(PASSWORD, "quartz-meadow-lantern-ember-fjord")).toEqual({
        outcome: "unchanged",
        reason: says.currentPasswordWrong,
      });
      expect(await first.changePassword(NEXT, "quartz-meadow-lantern-ember-fjord")).toEqual({
        outcome: "changed",
        notice: null,
      });
      expect(await decryptsWith("quartz-meadow-lantern-ember-fjord")).toBe(true);
    });

    it("forgets a change left unknown once the wallet is reset, so the next wallet's password can change", async () => {
      const first = await storedWallet();
      failNextWrite(true, true);
      expect((await first.changePassword(PASSWORD, NEXT)).outcome).toBe("indeterminate");

      device.vault.unavailable = false;
      expect(await first.resetWallet()).toEqual({ ok: true });
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      expect(await first.changePassword(PASSWORD, NEXT)).toEqual({
        outcome: "changed",
        notice: null,
      });
      expect(await decryptsWith(NEXT)).toBe(true);
    });

    it("settles a change left unknown when what is read back is another record", async () => {
      const first = await storedWallet();
      failNextWrite(true, true);
      expect((await first.changePassword(PASSWORD, NEXT)).outcome).toBe("indeterminate");

      device.vault.unavailable = false;
      const elsewhere = "harbour-quilt-saffron-plum-anvil";
      device.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(await seal(await newVaultKey(elsewhere), "{}")),
      );
      expect(await first.changePassword(PASSWORD, NEXT)).toEqual({
        outcome: "unchanged",
        reason: says.currentPasswordWrong,
      });
    });
  });

  describe("a password change that hands the new key on", () => {
    it("gives the new key's bits once the record is sealed under it, then zeroes them", async () => {
      const first = await storedWallet();
      let handed: Uint8Array | null = null;
      let copy: Uint8Array | null = null;
      let storedWhenHanded: string | null = null;
      const onRekey = vi.fn(async (bits: Uint8Array) => {
        handed = bits;
        copy = Uint8Array.from(bits);
        storedWhenHanded = device.localStorage.getItem(STORAGE_KEY);
        return true;
      });

      expect(await first.changePassword(PASSWORD, NEXT, { onRekey })).toEqual({
        outcome: "changed",
        notice: null,
      });
      expect(onRekey).toHaveBeenCalledTimes(1);
      expect(storedWhenHanded).toBe(device.localStorage.getItem(STORAGE_KEY));
      expect(copy).toEqual(await vaultKeyBits(storedEnvelope(), NEXT));
      expect([...handed!].every((byte) => byte === 0)).toBe(true);

      expect(await decryptsWith(NEXT)).toBe(true);
      expect(await decryptsWith(PASSWORD)).toBe(false);
      const second = await tab();
      expect(await second.unlockWithKeyBits(copy!)).toBeNull();
      expect(first.isUnlocked()).toBe(true);
      expect(await first.updateWallet((wallet) => ({ ...wallet, watchlist: ["SPYx"] }))).toBe(true);
      expect(await decryptsWith(NEXT)).toBe(true);
    });

    for (const [refusal, onRekey] of [
      ["returns false", async () => false],
      [
        "throws",
        async () => {
          throw new Error("keystore unavailable");
        },
      ],
    ] as const) {
      it(`is undone as a whole when the callback ${refusal}`, async () => {
        const first = await storedWallet();
        const before = device.localStorage.getItem(STORAGE_KEY);
        let handed: Uint8Array | null = null;

        expect(
          await first.changePassword(PASSWORD, NEXT, {
            onRekey: (bits) => {
              handed = bits;
              return onRekey();
            },
          }),
        ).toEqual({ outcome: "unchanged", reason: says.rekeyRefused });
        expect(device.localStorage.getItem(STORAGE_KEY)).toBe(before);
        expect([...handed!].every((byte) => byte === 0)).toBe(true);
        expect(await first.verifyPassword(PASSWORD)).toEqual(FIXTURE_PHRASE);
        expect(await first.verifyPassword(NEXT)).toBeNull();

        expect(first.isUnlocked()).toBe(true);
        expect(await first.updateWallet((wallet) => ({ ...wallet, watchlist: ["SPYx"] }))).toBe(
          true,
        );
        expect(await decryptsWith(PASSWORD)).toBe(true);
        const second = await tab();
        expect(await second.unlock(PASSWORD)).toBeNull();
        expect(second.getSnapshot()?.watchlist).toEqual(["SPYx"]);
      });
    }

    it("keeps a change made while the callback ran, under the old key, when it is undone", async () => {
      const first = await storedWallet();
      let release!: (accept: boolean) => void;
      const changing = first.changePassword(PASSWORD, NEXT, {
        onRekey: () => new Promise<boolean>((resolve) => (release = resolve)),
      });
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      const renaming = first.updateWallet((wallet) => ({ ...wallet, watchlist: ["NVDAx"] }));
      release(false);

      expect(await changing).toEqual({ outcome: "unchanged", reason: says.rekeyRefused });
      expect(await renaming).toBe(true);
      const second = await tab();
      expect(await second.unlock(PASSWORD)).toBeNull();
      expect(second.getSnapshot()?.watchlist).toEqual(["NVDAx"]);
    });

    it("says so when the old record cannot be put back, and keeps working under the new key", async () => {
      const first = await storedWallet();
      const result = await first.changePassword(PASSWORD, NEXT, {
        onRekey: async () => {
          device.state.refuseWrites = true;
          return false;
        },
      });
      device.state.refuseWrites = false;

      expect(result).toEqual({ outcome: "changed", notice: says.rekeyNotUndone });
      expect(await decryptsWith(NEXT)).toBe(true);
      expect(first.isUnlocked()).toBe(true);
      expect(await first.updateWallet((wallet) => ({ ...wallet, watchlist: ["SPYx"] }))).toBe(true);
      expect(await decryptsWith(NEXT)).toBe(true);
    });

    it("does not call back when the current password is wrong", async () => {
      const first = await storedWallet();
      const onRekey = vi.fn(async () => true);
      expect(await first.changePassword("not-the-password", NEXT, { onRekey })).toEqual({
        outcome: "unchanged",
        reason: says.currentPasswordWrong,
      });
      expect(onRekey).not.toHaveBeenCalled();
    });
  });
});
