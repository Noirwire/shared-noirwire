import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveKeypair } from "../../src/infrastructure/solana/keys.js";
import { isEnvelope, newVaultKey, open, seal, vaultKeyFor } from "../../src/wallet/keystore.js";
import { type Wallet } from "../../src/domain/wallet.js";
import {
  fromStored,
  LEGACY_STORAGE_KEY,
  LOCK_SIGNAL_KEY,
  STORAGE_KEY,
  toStored,
  type OpenRecord,
  type StoredRecord,
  type StoredWallet,
} from "../../src/wallet/types.js";
import { fastKeyDerivation } from "./support/fastKdf.js";
import { fakeDevice, type FakeDevice } from "./support/device.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_PHRASE,
  UNNORMALISED_PASSWORD,
  UNNORMALISED_VAULT_JSON,
  V8_WALLET_JSON,
} from "./support/walletFixtures.js";

const PASSWORD = "orbit-cactus-lamp-velvet-quarry";
const MNEMONIC = FIXTURE_PHRASE.join(" ");
const addressAt = (index: number) => deriveKeypair(MNEMONIC, index, "app").publicKey.toBase58();

function makeWallet(): Wallet {
  return {
    createdAt: 1_750_000_000_000,
    derivationScheme: "app",
    funding: { address: addressAt(0), sol: 2, tokens: { USDC: 40 } },
    portfolios: [
      {
        id: "acc_1",
        label: "Rainy-day-label",
        address: addressAt(1),
        derivationIndex: 1,
        createdAt: 1_750_000_000_000,
        archivedAt: null,
        holdings: [{ symbol: "NVDAx", amount: 3, cost: 300 }],
      },
    ],
    activity: [
      {
        id: "act_1",
        portfolioId: "acc_1",
        at: 1_750_000_001_000,
        kind: "send",
        symbol: "USDC",
        amount: 5,
        usd: 5,
        counterparty: addressAt(7),
      },
    ],
    watchlist: ["SPYx"],
  };
}

let window: FakeDevice;

/**
 * These suites are about what the store does with a key. The key itself is
 * derived in one round here; the real derivation is proven by the records
 * captured from real apps, by `keystore.test.ts`, and by the one round trip
 * below that asks for it.
 */
let realKeyDerivation: () => void = () => undefined;
beforeEach(() => {
  realKeyDerivation = fastKeyDerivation();
});
afterEach(() => realKeyDerivation());

/**
 * The store keeps its state in module scope, so a freshly imported copy is a
 * freshly loaded tab: locked, knowing only what is in the vault. Several
 * copies over one device are several tabs of one browser, sharing its vault
 * and its locks.
 */
async function openTab() {
  vi.resetModules();
  const { installPlatform } = await import("../../src/platform.js");
  installPlatform(window.platform());
  return import("../../src/wallet/store.js");
}

type Tab = Awaited<ReturnType<typeof openTab>>;

/** Whether a wallet is stored, once the tab has asked the vault. */
async function presence(store: Tab) {
  store.walletExists();
  await vi.waitFor(() => expect(store.walletExists()).not.toBeUndefined());
  return store.walletExists();
}

async function decryptStored(window: FakeDevice, password: string): Promise<StoredRecord | null> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const envelope: unknown = raw ? JSON.parse(raw) : null;
  if (!isEnvelope(envelope)) return null;
  const plaintext = await open(await vaultKeyFor(envelope, password), envelope);
  return plaintext === null ? null : (JSON.parse(plaintext) as StoredRecord);
}

async function seedStored(window: FakeDevice, stored: StoredRecord, password = PASSWORD) {
  const envelope = await seal(await newVaultKey(password), JSON.stringify(stored));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

async function seedRecord(window: FakeDevice, opened: OpenRecord, password = PASSWORD) {
  const stored: StoredRecord = { ...opened, wallet: toStored(opened.wallet) };
  const envelope = await seal(await newVaultKey(password), JSON.stringify(stored));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

const rename = (label: string) => (wallet: Wallet) => ({
  ...wallet,
  portfolios: wallet.portfolios.map((portfolio) => ({ ...portfolio, label })),
});

describe("the wallet store", () => {
  const tabs: Awaited<ReturnType<typeof openTab>>[] = [];

  async function tab() {
    const opened = await openTab();
    tabs.push(opened);
    return opened;
  }

  beforeEach(() => {
    window = fakeDevice();
  });

  afterEach(() => {
    // Locking clears each tab's idle timer, which would otherwise outlive the test.
    tabs.splice(0).forEach((opened) => opened.lock());
    vi.useRealTimers();
  });

  describe("with the real key derivation", () => {
    it("stores a wallet, refuses a wrong password and opens with the right one", async () => {
      realKeyDerivation();
      const derived = vi.spyOn(crypto.subtle, "deriveKey");
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);

      const reloaded = await tab();
      expect(await reloaded.unlock("not-the-password")).toMatch(/does not match/);
      expect(reloaded.getPhrase()).toBeNull();
      expect(await reloaded.unlock(PASSWORD)).toBeNull();
      expect(reloaded.getPhrase()).toEqual(FIXTURE_PHRASE);

      const rounds = derived.mock.calls.map(
        ([algorithm]) => (algorithm as Pbkdf2Params).iterations,
      );
      expect(rounds.length).toBeGreaterThanOrEqual(3);
      expect(new Set(rounds)).toEqual(new Set([600_000]));
      derived.mockRestore();
    });
  });

  describe("what is stored", () => {
    it("is one encrypted envelope and nothing else", async () => {
      const store = await tab();
      const wallet = makeWallet();
      await store.storeNewWallet(wallet, FIXTURE_PHRASE, PASSWORD);

      expect([...window.backing.keys()]).toEqual([STORAGE_KEY]);
      const raw = window.localStorage.getItem(STORAGE_KEY)!;
      expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(
        ["ciphertext", "iterations", "iv", "kdf", "salt", "v"].sort(),
      );

      const readable = [
        wallet.funding.address,
        wallet.portfolios[0].address,
        wallet.activity[0].counterparty!,
        "Rainy-day-label",
        "acc_1",
        "NVDAx",
        "SPYx",
        "USDC",
        "derivationIndex",
        ...FIXTURE_PHRASE.map((word) => `"${word}"`),
      ];
      for (const fragment of readable) expect(raw).not.toContain(fragment);

      expect(await decryptStored(window, PASSWORD)).toEqual({
        rev: 1,
        phrase: FIXTURE_PHRASE,
        wallet: toStored(wallet),
      });
    });

    it("is rewritten under a fresh IV and the same key on every routine write", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const seen = [JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { iv: string }];

      for (const label of ["one", "two", "three"]) {
        expect(await store.updateWallet(rename(label))).toBe(true);
        seen.push(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as { iv: string });
      }

      expect(new Set(seen.map((envelope) => envelope.iv)).size).toBe(4);
      expect(new Set(seen.map((envelope) => (envelope as { salt?: string }).salt)).size).toBe(1);
      const stored = await decryptStored(window, PASSWORD);
      expect(stored?.rev).toBe(4);
      expect(stored?.wallet.accounts[0].label).toBe("three");
      expect([...window.backing.keys()]).toEqual([STORAGE_KEY]);
    });

    it("keeps writes in the order they were made", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const labels = Array.from({ length: 12 }, (_, index) => `label-${index}`);
      await Promise.all(labels.map((label) => store.updateWallet(rename(label))));
      expect((await decryptStored(window, PASSWORD))?.wallet.accounts[0].label).toBe("label-11");
      expect(store.getSnapshot()?.portfolios[0].label).toBe("label-11");
    });

    const PLAINTEXT_KEYS = [
      "noirwire.prototype.wallet.v7",
      "noirwire.prototype.wallet.v2",
      "noirwire.wallet.v7",
    ];
    const seedPlaintext = () => {
      for (const key of PLAINTEXT_KEYS) window.localStorage.setItem(key, '{"phrase":["legal"]}');
      window.localStorage.setItem("noirwire.selectedPortfolio", "acc_1");
      window.localStorage.setItem("noirwire.analytics", "off");
    };

    it("never deletes an old plain text wallet on load: it may be the only copy of the phrase", async () => {
      seedPlaintext();
      const store = await tab();
      expect(await presence(store)).toBe(false);
      expect(store.getSnapshot()).toBeNull();
      for (const key of PLAINTEXT_KEYS) expect(window.backing.has(key)).toBe(true);
      // The plain portfolio selection is not a wallet and goes at once.
      expect(window.backing.has("noirwire.selectedPortfolio")).toBe(false);
    });

    it("finishes deleting old plain text wallets at load once a current wallet is stored", async () => {
      // Storing the current wallet already ordered them deleted; a copy still
      // there is a deletion that did not complete, and it is completed now.
      await (await tab()).storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      seedPlaintext();

      const store = await tab();
      expect(await presence(store)).toBe(true);
      await vi.waitFor(() =>
        expect([...window.backing.keys()].sort()).toEqual(
          [STORAGE_KEY, "noirwire.analytics"].sort(),
        ),
      );
      expect(await store.unlock("not-the-password")).toMatch(/does not match/);
      expect(await store.unlock(PASSWORD)).toBeNull();
      expect(store.isPlaintextCleanupFailing()).toBe(false);
    });

    it("drops old plain text wallets once a new wallet is stored", async () => {
      seedPlaintext();
      const store = await tab();
      window.state.refuseWrites = true;
      await expect(store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD)).rejects.toThrow();
      for (const key of PLAINTEXT_KEYS) expect(window.backing.has(key)).toBe(true);

      window.state.refuseWrites = false;
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      await vi.waitFor(() => {
        for (const key of PLAINTEXT_KEYS) expect(window.backing.has(key)).toBe(false);
      });
    });
  });

  describe("while locked", () => {
    it("knows only that a wallet exists", async () => {
      await (await tab()).storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);

      const store = await tab();
      expect(await presence(store)).toBe(true);
      expect(store.getSnapshot()).toBeNull();
      expect(store.isUnlocked()).toBe(false);
      expect(store.getPhrase()).toBeNull();
      expect(await store.updateWallet(rename("ignored"))).toBe(false);
    });

    it("stays locked on a wrong password", async () => {
      await (await tab()).storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);

      const store = await tab();
      expect(await store.unlock("not-the-password")).toMatch(/does not match/);
      expect(store.isUnlocked()).toBe(false);
      expect(store.getSnapshot()).toBeNull();

      expect(await store.unlock(PASSWORD)).toBeNull();
      expect(store.getSnapshot()?.funding.address).toBe(addressAt(0));
      expect(store.getPhrase()).toEqual(FIXTURE_PHRASE);
    });

    it("unlocks with NoirWire out of reach, and asks nothing of the network to do it", async () => {
      await (await tab()).storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const unreachable = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });
      vi.stubGlobal("fetch", unreachable);
      try {
        const store = await tab();
        expect(await store.unlock("not-the-password")).toMatch(/does not match/);
        expect(await store.unlock(PASSWORD)).toBeNull();
        expect(store.isUnlocked()).toBe(true);
        expect(store.getSnapshot()?.funding.address).toBe(addressAt(0));
        expect(unreachable).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("drops everything decrypted when locked again", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      store.lock();
      expect(store.getSnapshot()).toBeNull();
      expect(store.getPhrase()).toBeNull();
      expect(await presence(store)).toBe(true);
    });
  });

  describe("the stored field names", () => {
    /** A current record exactly as wallets already in browsers hold it, with a field this version does not know. */
    const storedToday = (): StoredRecord => ({
      rev: 7,
      phrase: FIXTURE_PHRASE,
      wallet: {
        createdAt: 1_750_000_000_000,
        derivationScheme: "app",
        funding: { address: addressAt(0), sol: 2, tokens: { USDC: 40 } },
        accounts: [
          {
            id: "acc_1",
            label: "Rainy-day-label",
            address: addressAt(1),
            derivationIndex: 1,
            createdAt: 1_750_000_000_000,
            archivedAt: null,
            holdings: [{ symbol: "NVDAx", amount: 3, cost: 300 }],
          },
        ],
        activity: [
          {
            id: "act_1",
            accountId: "acc_1",
            at: 1_750_000_001_000,
            kind: "send",
            symbol: "USDC",
            amount: 5,
            usd: 5,
            counterparty: addressAt(7),
          },
        ],
        watchlist: ["SPYx"],
        ...({ laterField: { kept: true } } as object),
      },
    });

    it("opens a record of the current version under the names it was written with", async () => {
      await seedStored(window, storedToday());
      const store = await tab();
      expect(await store.unlock(PASSWORD)).toBeNull();
      const wallet = store.getSnapshot()!;
      expect(wallet.portfolios.map((portfolio) => portfolio.id)).toEqual(["acc_1"]);
      expect(wallet.portfolios[0].label).toBe("Rainy-day-label");
      expect(wallet.activity[0].portfolioId).toBe("acc_1");
      expect(wallet).not.toHaveProperty("accounts");
      expect(wallet.activity[0]).not.toHaveProperty("accountId");
    });

    it("writes the same names back, and keeps a field it does not know", async () => {
      await seedStored(window, storedToday());
      const store = await tab();
      expect(await store.unlock(PASSWORD)).toBeNull();
      expect(await store.updateWallet(rename("renamed"))).toBe(true);

      const written = (await decryptStored(window, PASSWORD))!;
      const expected = storedToday();
      expected.rev = 8;
      expected.wallet.accounts[0].label = "renamed";
      expect(written).toEqual(expected);
      expect(written.wallet).not.toHaveProperty("portfolios");
      expect(written.wallet.activity[0]).not.toHaveProperty("portfolioId");
    });

    it("opens a record whose activity belongs to the funding wallet, and refuses one that names no portfolio", async () => {
      const arrival = {
        id: "act_2",
        accountId: "funding",
        at: 1_750_000_002_000,
        kind: "deposit" as const,
        symbol: "USDC",
        amount: 25,
        usd: 25,
      };
      const record = storedToday();
      record.wallet.activity.unshift(arrival);
      record.wallet.funding.balancesRead = true;
      await seedStored(window, record);
      const store = await tab();
      expect(await store.unlock(PASSWORD)).toBeNull();
      expect(store.getSnapshot()?.activity[0]).toMatchObject({
        portfolioId: "funding",
        kind: "deposit",
        amount: 25,
      });
      expect(store.getSnapshot()?.funding.balancesRead).toBe(true);

      const stray = storedToday();
      stray.wallet.activity.unshift({ ...arrival, accountId: "acc_gone" });
      await seedStored(window, stray);
      const other = await tab();
      expect(await other.unlock(PASSWORD)).not.toBeNull();
      expect(other.getSnapshot()).toBeNull();
    });

    it("reads the activity of a v8 wallet under the names it was written with", async () => {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, V8_WALLET_JSON);
      const store = await tab();
      expect(await store.unlock(FIXTURE_PASSWORD)).toBeNull();
      const wallet = store.getSnapshot()!;
      expect(wallet.portfolios.map((portfolio) => portfolio.label)).toEqual([
        "Investing",
        "Rainy day",
      ]);
      expect(wallet.activity[0].portfolioId).toBe("acc_fixture1");
      const written = (await decryptStored(window, FIXTURE_PASSWORD))!;
      expect(written.wallet.accounts).toHaveLength(2);
      expect(written.wallet.activity[0].accountId).toBe("acc_fixture1");
    });
  });

  describe("upgrading a v8 wallet", () => {
    it("moves it into an encrypted record at the first unlock and removes the old key", async () => {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, V8_WALLET_JSON);
      const before = JSON.parse(V8_WALLET_JSON) as StoredWallet & { vault: unknown };

      const store = await tab();
      expect(await presence(store)).toBe(true);
      expect(store.getSnapshot()).toBeNull();

      expect(await store.unlock("not-the-password")).toMatch(/does not match/);
      expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(V8_WALLET_JSON);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

      expect(await store.unlock(FIXTURE_PASSWORD)).toBeNull();
      expect([...window.backing.keys()]).toEqual([STORAGE_KEY]);

      const { vault, ...wallet } = before;
      expect(vault).toBeDefined();
      expect(store.getSnapshot()).toEqual(fromStored(wallet));
      expect(store.getPhrase()).toEqual(FIXTURE_PHRASE);
      expect(await decryptStored(window, FIXTURE_PASSWORD)).toEqual({
        rev: 1,
        phrase: FIXTURE_PHRASE,
        wallet,
      });
      expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain(wallet.funding.address);

      // And it opens from the new record alone on the next page load.
      const reloaded = await tab();
      expect(await reloaded.unlock(FIXTURE_PASSWORD)).toBeNull();
      expect(reloaded.getSnapshot()).toEqual(fromStored(wallet));
    });

    it("leaves the v8 record alone when the new one cannot be written", async () => {
      window.localStorage.setItem(LEGACY_STORAGE_KEY, V8_WALLET_JSON);
      const store = await tab();
      window.state.refuseWrites = true;

      expect(await store.unlock(FIXTURE_PASSWORD)).toMatch(/would not save/);
      expect(store.isUnlocked()).toBe(false);
      expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(V8_WALLET_JSON);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

      window.state.refuseWrites = false;
      expect(await store.unlock(FIXTURE_PASSWORD)).toBeNull();
      expect([...window.backing.keys()]).toEqual([STORAGE_KEY]);
    });

    it("opens a vault made from an unnormalised password and re-encrypts under the normalised form", async () => {
      const legacy = {
        ...(JSON.parse(V8_WALLET_JSON) as object),
        vault: JSON.parse(UNNORMALISED_VAULT_JSON) as unknown,
      };
      window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));

      expect(await (await tab()).unlock(UNNORMALISED_PASSWORD)).toBeNull();
      expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

      // Either spelling opens the new record, because both fold to one form.
      expect(await (await tab()).unlock(UNNORMALISED_PASSWORD)).toBeNull();
      expect(await (await tab()).unlock(UNNORMALISED_PASSWORD.normalize("NFKC"))).toBeNull();
    });
  });

  describe("re-deriving addresses at unlock", () => {
    it("refuses a record whose stored portfolio address is not the derived one", async () => {
      const wallet = makeWallet();
      wallet.portfolios[0].address = addressAt(5);
      await seedRecord(window, { rev: 1, phrase: FIXTURE_PHRASE, wallet });

      const store = await tab();
      expect(await store.unlock(PASSWORD)).toMatch(/do not match its recovery phrase/);
      expect(store.isUnlocked()).toBe(false);
      expect(store.getSnapshot()).toBeNull();
      expect(store.getPhrase()).toBeNull();
    });

    it("refuses a record whose stored funding address is not the derived one", async () => {
      const wallet = makeWallet();
      wallet.funding.address = addressAt(3);
      await seedRecord(window, { rev: 1, phrase: FIXTURE_PHRASE, wallet });

      const store = await tab();
      expect(await store.unlock(PASSWORD)).toMatch(/do not match its recovery phrase/);
      expect(store.isUnlocked()).toBe(false);
    });

    it("refuses a record stored under the other derivation scheme's addresses", async () => {
      const wallet: Wallet = { ...makeWallet(), derivationScheme: "walletDefault" };
      await seedRecord(window, { rev: 1, phrase: FIXTURE_PHRASE, wallet });
      expect(await (await tab()).unlock(PASSWORD)).toMatch(/do not match its recovery phrase/);
    });

    it("refuses a tampered v8 record and upgrades nothing", async () => {
      const tampered = JSON.parse(V8_WALLET_JSON) as StoredWallet;
      tampered.accounts[1].address = addressAt(8);
      const raw = JSON.stringify(tampered);
      window.localStorage.setItem(LEGACY_STORAGE_KEY, raw);

      const store = await tab();
      expect(await store.unlock(FIXTURE_PASSWORD)).toMatch(/do not match its recovery phrase/);
      expect(store.isUnlocked()).toBe(false);
      expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("still opens a wallet whose stored icon is garbage", async () => {
      const wallet = makeWallet();
      (wallet.portfolios[0] as unknown as Record<string, unknown>).icon = {
        glyph: "nope",
        tint: 7,
      };
      await seedRecord(window, { rev: 1, phrase: FIXTURE_PHRASE, wallet });

      const store = await tab();
      expect(await store.unlock(PASSWORD)).toBeNull();
      expect(store.getSnapshot()?.portfolios[0].id).toBe("acc_1");
    });
  });

  describe("an unlock that finishes late", () => {
    beforeEach(async () => {
      await (await tab()).storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
    });

    it("is discarded when the wallet was locked while the key was derived", async () => {
      const store = await tab();
      const pending = store.unlock(PASSWORD);
      store.lock();
      expect(await pending).toMatch(/locked or changed/);
      expect(store.isUnlocked()).toBe(false);
      expect(store.getSnapshot()).toBeNull();
      expect(store.getPhrase()).toBeNull();
    });

    it("is discarded when the wallet was reset while the key was derived", async () => {
      const store = await tab();
      const pending = store.unlock(PASSWORD);
      const resetting = store.resetWallet();
      expect(await pending).toMatch(/locked or changed/);
      expect(store.isUnlocked()).toBe(false);
      expect(await resetting).toEqual({ ok: true });
      expect(await presence(store)).toBe(false);
      expect(window.backing.size).toBe(0);
    });

    it("is discarded when another tab replaced the wallet meanwhile", async () => {
      // Sealed up front: deriving a second key here would race the unlock it is meant to interrupt.
      const replacement = JSON.stringify(
        await seal(
          await newVaultKey("another"),
          JSON.stringify({ rev: 1, phrase: FIXTURE_PHRASE, wallet: toStored(makeWallet()) }),
        ),
      );
      const store = await tab();
      const pending = store.unlock(PASSWORD);
      window.localStorage.setItem(STORAGE_KEY, replacement);
      expect(await pending).toMatch(/locked or changed/);
      expect(store.isUnlocked()).toBe(false);
    });

    it("does not bring back a v8 wallet that was reset while it was being upgraded", async () => {
      window.backing.clear();
      window.localStorage.setItem(LEGACY_STORAGE_KEY, V8_WALLET_JSON);
      const store = await tab();
      const pending = store.unlock(FIXTURE_PASSWORD);
      const resetting = store.resetWallet();
      expect(await pending).toMatch(/locked or changed/);
      expect(store.isUnlocked()).toBe(false);
      expect(await resetting).toEqual({ ok: true });
      expect(window.backing.size).toBe(0);
    });
  });

  describe("locking is wallet-wide", () => {
    async function twoUnlocked() {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      first.subscribe(() => undefined);
      const second = await tab();
      second.subscribe(() => undefined);
      expect(await second.unlock(PASSWORD)).toBeNull();
      return { first, second };
    }

    it("locks every other tab when one is locked, and announces nothing about the wallet", async () => {
      const { first, second } = await twoUnlocked();
      first.lock();
      expect(first.isUnlocked()).toBe(false);
      await vi.waitFor(() => expect(second.isUnlocked()).toBe(false));
      expect(second.getPhrase()).toBeNull();
      expect(second.getSnapshot()).toBeNull();
      expect(window.localStorage.getItem(LOCK_SIGNAL_KEY)).toMatch(/^\d+$/);
      // The wallet is still there, and opens again in either tab.
      expect(await second.unlock(PASSWORD)).toBeNull();
    });

    it("does not lock itself again on its own announcement, once unlocked afresh", async () => {
      const { first, second } = await twoUnlocked();
      first.lock();
      await vi.waitFor(() => expect(second.isUnlocked()).toBe(false));
      expect(await first.unlock(PASSWORD)).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(first.isUnlocked()).toBe(true);
    });

    it("locks the others again on every lock, not only the first", async () => {
      const { first, second } = await twoUnlocked();
      first.lock();
      await vi.waitFor(() => expect(second.isUnlocked()).toBe(false));
      expect(await first.unlock(PASSWORD)).toBeNull();
      expect(await second.unlock(PASSWORD)).toBeNull();
      second.lock();
      await vi.waitFor(() => expect(first.isUnlocked()).toBe(false));
    });

    it("leaves a tab alone when this one only went idle", async () => {
      const { first, second } = await twoUnlocked();
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60 * 60 * 1000);
      expect(first.lockIfIdle()).toBe(true);
      vi.restoreAllMocks();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(second.isUnlocked()).toBe(true);
    });

    it("locks every other tab on a reset, and a lock gets through after a reset that could write nothing", async () => {
      const { first, second } = await twoUnlocked();
      window.state.refuseWrites = true;
      expect(await first.resetWallet()).toEqual({ ok: false, reason: "notRemoved" });
      window.state.refuseWrites = false;
      // The announcement could not be written either; the next lock gets through.
      first.lock();
      await vi.waitFor(() => expect(second.isUnlocked()).toBe(false));

      expect(await second.unlock(PASSWORD)).toBeNull();
      expect(await first.resetWallet()).toEqual({ ok: true });
      await vi.waitFor(() => expect(second.isUnlocked()).toBe(false));
      expect(window.backing.size).toBe(0);
    });
  });

  describe("changing the password to the same password", () => {
    it("is refused in plain words, and nothing is written", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const stored = window.localStorage.getItem(STORAGE_KEY);
      expect(await store.changePassword(PASSWORD, PASSWORD)).toEqual({
        outcome: "unchanged",
        reason: "That is already your password.",
      });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
      expect(await store.changePassword("not-it", "not-it")).toMatchObject({
        reason: "Your current password is not right.",
      });
    });
  });

  describe("two tabs", () => {
    it("refuses to finish onboarding over a wallet another tab stored meanwhile", async () => {
      const second = await tab();
      expect(await presence(second)).toBe(false);

      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const stored = window.localStorage.getItem(STORAGE_KEY);

      const other = { ...makeWallet(), watchlist: ["other"] };
      await expect(second.storeNewWallet(other, FIXTURE_PHRASE, "second-password")).rejects.toThrow(
        /already exists on this device/,
      );
      expect(second.isUnlocked()).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    });

    it("refuses to finish onboarding over a v8 wallet too", async () => {
      const store = await tab();
      window.localStorage.setItem(LEGACY_STORAGE_KEY, V8_WALLET_JSON);
      await expect(store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD)).rejects.toThrow(
        /already exists on this device/,
      );
      expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(V8_WALLET_JSON);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("applies a stale tab's change to the newer stored record instead of over it", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      expect(await second.unlock(PASSWORD)).toBeNull();

      expect(await first.updateWallet(rename("renamed in the first tab"))).toBe(true);
      // The second tab never heard about that write and still shows the old label.
      expect(second.getSnapshot()?.portfolios[0].label).toBe("Rainy-day-label");
      expect(
        await second.updateWallet((wallet) => ({ ...wallet, watchlist: ["SPYx", "NVDAx"] })),
      ).toBe(true);

      const stored = await decryptStored(window, PASSWORD);
      expect(stored?.wallet.accounts[0].label).toBe("renamed in the first tab");
      expect(stored?.wallet.watchlist).toEqual(["SPYx", "NVDAx"]);
      expect(stored?.rev).toBe(3);
      // And the stale tab now shows what is stored.
      expect(second.getSnapshot()).toEqual(stored && fromStored(stored.wallet));
    });

    it("drops the session with the wallet, in the tab that reset and in the others", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      // The second tab's own copy of the package: it holds a session in memory.
      const { keepSessionWith } = await import("../../src/infrastructure/apiSession.js");
      const { fakeSession } = await import("../../src/testing/index.js");
      const held = fakeSession();
      keepSessionWith(held);
      second.subscribe(() => undefined);
      expect(await presence(second)).toBe(true);
      window.sessionStore.value = JSON.stringify({ accessToken: "of-the-old-wallet" });

      expect(await first.resetWallet()).toEqual({ ok: true });
      expect(window.sessionStore.value).toBeNull();
      await vi.waitFor(() => expect(held.drops).toBe(1));
    });

    it("keeps the session when the wallet would not go", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      window.sessionStore.value = "kept";
      window.state.refuseWrites = true;
      expect(await first.resetWallet()).toEqual({ ok: false, reason: "notRemoved" });
      expect(window.sessionStore.value).toBe("kept");
    });

    it("does not bring back a wallet another tab reset", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      expect(await second.unlock(PASSWORD)).toBeNull();

      expect(await first.resetWallet()).toEqual({ ok: true });
      expect(window.backing.size).toBe(0);

      expect(await second.updateWallet(rename("too late"))).toBe(false);
      expect(window.backing.size).toBe(0);
      expect(second.isUnlocked()).toBe(false);
      expect(await presence(second)).toBe(false);
    });

    it("locks a tab whose wallet was re-encrypted elsewhere rather than writing the old key back", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      expect(await second.unlock(PASSWORD)).toBeNull();

      const next = "plum-anvil-harbour-quilt-saffron";
      expect(await first.changePassword(PASSWORD, next)).toMatchObject({ outcome: "changed" });
      const stored = window.localStorage.getItem(STORAGE_KEY);

      expect(await second.updateWallet(rename("stale key"))).toBe(false);
      expect(second.isUnlocked()).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    });
  });

  describe("two writers at once", () => {
    it("stores one of two new wallets created at the same moment, and refuses the other", async () => {
      const [first, second] = [await tab(), await tab()];
      const outcomes = await Promise.allSettled([
        first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD),
        second.storeNewWallet({ ...makeWallet(), watchlist: ["other"] }, FIXTURE_PHRASE, "another"),
      ]);
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
      const refused = outcomes.find((outcome) => outcome.status === "rejected");
      expect((refused as PromiseRejectedResult).reason).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(/already exists on this device/),
        }),
      );
      expect([first.isUnlocked(), second.isUnlocked()].sort()).toEqual([false, true]);
      const winner = first.isUnlocked() ? PASSWORD : "another";
      expect(await decryptStored(window, winner)).not.toBeNull();
    });

    it("refuses a password change over a record that changed while it ran", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      expect(await second.unlock(PASSWORD)).toBeNull();

      const changing = first.changePassword(PASSWORD, "plum-anvil-harbour-quilt-saffron");
      expect(await second.updateWallet(rename("written meanwhile"))).toBe(true);
      const stored = window.localStorage.getItem(STORAGE_KEY);
      await changing;

      // Whichever way the race fell, the other tab's write was not lost.
      const kept =
        (await decryptStored(window, PASSWORD)) ??
        (await decryptStored(window, "plum-anvil-harbour-quilt-saffron"));
      expect(kept?.wallet.accounts[0].label).toBe("written meanwhile");
      expect(stored).not.toBeNull();
    });

    it("still creates, updates and unlocks a wallet", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      expect(await store.updateWallet(rename("no locks"))).toBe(true);
      const reloaded = await tab();
      expect(await reloaded.unlock(PASSWORD)).toBeNull();
      expect(reloaded.getSnapshot()?.portfolios[0].label).toBe("no locks");
    });
  });

  describe("a signer session", () => {
    async function unlockedTab() {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const { unlockedSession } = await import("../../src/wallet/session.js");
      const session = unlockedSession();
      if ("refused" in session) throw new Error(session.refused);
      return { store, session, unlockedSession };
    }

    it("hands out the keys for the addresses on screen while unlocked", async () => {
      const { session } = await unlockedTab();
      expect(session.fundingSigner()?.publicKey.toBase58()).toBe(addressAt(0));
      expect(session.portfolioSigner(session.wallet.portfolios[0])?.publicKey.toBase58()).toBe(
        addressAt(1),
      );
      expect(session.keyAt(4)?.publicKey.toBase58()).toBe(addressAt(4));
      expect(session.live()).toBe(true);
    });

    it("refuses every signer once the store is locked", async () => {
      const { store, session, unlockedSession } = await unlockedTab();
      const [portfolio] = session.wallet.portfolios;
      store.lock();

      expect(session.live()).toBe(false);
      expect(session.fundingSigner()).toBeNull();
      expect(session.portfolioSigner(portfolio)).toBeNull();
      expect(session.keyAt(4)).toBeNull();
      expect(session.refusal()).toBe("walletLocked");
      expect(unlockedSession()).toEqual({ refused: "walletLocked" });
    });

    it("stays refused after the wallet is unlocked again: a new unlock needs a new session", async () => {
      const { store, session } = await unlockedTab();
      store.lock();
      expect(await store.unlock(PASSWORD)).toBeNull();
      expect(session.fundingSigner()).toBeNull();
      expect(session.live()).toBe(false);
    });

    it("refuses once the idle window has passed, even if no timer fired", async () => {
      const { store, session } = await unlockedTab();
      const unlockedAt = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(unlockedAt + 16 * 60 * 1000);

      expect(session.portfolioSigner(session.wallet.portfolios[0])).toBeNull();
      expect(store.isUnlocked()).toBe(false);
    });

    it("refuses after a reset", async () => {
      const { store, session } = await unlockedTab();
      const resetting = store.resetWallet();
      expect(session.fundingSigner()).toBeNull();
      expect(session.refusal()).toBe("walletLocked");
      expect(await resetting).toEqual({ ok: true });
    });

    it("refuses a key that is not the one for the stored address", async () => {
      const { session } = await unlockedTab();
      const [portfolio] = session.wallet.portfolios;
      expect(session.portfolioSigner({ ...portfolio, address: addressAt(6) })).toBeNull();
      expect(session.refusal()).toBe("keyMismatch");
    });
  });

  describe("changing the password", () => {
    it("re-encrypts the whole record and keeps the tab that did it working", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const next = "plum-anvil-harbour-quilt-saffron";

      expect(await store.changePassword("not-the-password", next)).toMatchObject({
        outcome: "unchanged",
        reason: expect.stringMatching(/not right/),
      });
      expect(await store.changePassword(PASSWORD, next)).toMatchObject({ outcome: "changed" });
      expect(await decryptStored(window, PASSWORD)).toBeNull();
      expect((await decryptStored(window, next))?.phrase).toEqual(FIXTURE_PHRASE);

      expect(store.isUnlocked()).toBe(true);
      expect(await store.updateWallet(rename("after the change"))).toBe(true);
      expect((await decryptStored(window, next))?.wallet.accounts[0].label).toBe(
        "after the change",
      );
      expect(await store.verifyPassword(next)).toEqual(FIXTURE_PHRASE);
      expect(await store.verifyPassword(PASSWORD)).toBeNull();
    });
  });

  describe("when the vault refuses to store", () => {
    it("fails loudly for a new wallet and leaves nothing unlocked", async () => {
      const store = await tab();
      window.state.refuseWrites = true;
      await expect(store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD)).rejects.toThrow(
        /would not save/,
      );
      expect(store.isUnlocked()).toBe(false);
      expect(await presence(store)).toBe(false);
      expect(window.backing.size).toBe(0);
    });

    it("raises a flag for routine writes, and clears it once a write lands", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      expect(store.isSaveFailing()).toBe(false);

      window.state.refuseWrites = true;
      expect(await store.updateWallet(rename("not kept yet"))).toBe(false);
      expect(store.isSaveFailing()).toBe(true);
      expect(store.getSnapshot()?.portfolios[0].label).toBe("not kept yet");
      expect((await decryptStored(window, PASSWORD))?.wallet.accounts[0].label).toBe(
        "Rainy-day-label",
      );

      window.state.refuseWrites = false;
      expect(await store.updateWallet((wallet) => ({ ...wallet, watchlist: ["later"] }))).toBe(
        true,
      );
      expect(store.isSaveFailing()).toBe(false);
      const stored = await decryptStored(window, PASSWORD);
      expect(stored?.wallet.accounts[0].label).toBe("not kept yet");
      expect(stored?.wallet.watchlist).toEqual(["later"]);
    });
  });

  describe("the snapshot in memory and the vault behind it", () => {
    it("answers whether a wallet exists only once the vault has, and says when it knows", async () => {
      await (await tab()).storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const store = await tab();
      const heard = vi.fn();
      store.subscribe(heard);
      expect(store.walletExists()).toBeUndefined();
      await vi.waitFor(() => expect(store.walletExists()).toBe(true));
      expect(heard).toHaveBeenCalled();
    });

    it("shows a change at once, before the vault has it, and stores it after", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const writing = store.updateWallet(rename("shown first"));
      expect(store.getSnapshot()?.portfolios[0].label).toBe("shown first");
      expect((await decryptStored(window, PASSWORD))?.wallet.accounts[0].label).toBe(
        "Rainy-day-label",
      );
      expect(await writing).toBe(true);
      expect((await decryptStored(window, PASSWORD))?.wallet.accounts[0].label).toBe("shown first");
    });

    it("never has two writes of the wallet in flight at once", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const update = window.vault.update.bind(window.vault);
      let inFlight = 0;
      let most = 0;
      window.vault.update = async (key, change) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        try {
          return await update(key, change);
        } finally {
          inFlight -= 1;
        }
      };
      const labels = Array.from({ length: 8 }, (_, index) => `label-${index}`);
      expect(await Promise.all(labels.map((label) => store.updateWallet(rename(label))))).toEqual(
        labels.map(() => true),
      );
      expect(most).toBe(1);
      expect((await decryptStored(window, PASSWORD))?.wallet.accounts[0].label).toBe("label-7");
    });

    it("says changes are not being kept when the vault cannot even be read, and keeps them for later", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      window.vault.unavailable = true;
      expect(await store.updateWallet(rename("held in memory"))).toBe(false);
      expect(store.isSaveFailing()).toBe(true);
      expect(store.isUnlocked()).toBe(true);
      expect(store.getSnapshot()?.portfolios[0].label).toBe("held in memory");

      window.vault.unavailable = false;
      expect(await store.syncFromStorage()).toBe(true);
      expect(store.isSaveFailing()).toBe(false);
      expect((await decryptStored(window, PASSWORD))?.wallet.accounts[0].label).toBe(
        "held in memory",
      );
    });

    it("takes in another tab's write as it happens, without being asked", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      expect(await second.unlock(PASSWORD)).toBeNull();
      const heard = vi.fn();
      second.subscribe(heard);

      expect(await first.updateWallet(rename("from the first tab"))).toBe(true);
      await vi.waitFor(() =>
        expect(second.getSnapshot()?.portfolios[0].label).toBe("from the first tab"),
      );
      expect(heard).toHaveBeenCalled();
      expect(second.isUnlocked()).toBe(true);
    });

    it("locks a listening tab the moment another tab changes the password", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      expect(await second.unlock(PASSWORD)).toBeNull();
      second.subscribe(() => undefined);

      expect(
        await first.changePassword(PASSWORD, "plum-anvil-harbour-quilt-saffron"),
      ).toMatchObject({
        outcome: "changed",
      });
      await vi.waitFor(() => expect(second.isUnlocked()).toBe(false));
      expect(second.getSnapshot()).toBeNull();
      expect(second.getPhrase()).toBeNull();
      expect(first.isUnlocked()).toBe(true);
    });

    it("keeps a locked tab locked, with nothing to read, when another tab writes", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      second.subscribe(() => undefined);
      expect(await presence(second)).toBe(true);

      expect(await first.updateWallet(rename("elsewhere"))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(second.isUnlocked()).toBe(false);
      expect(second.getSnapshot()).toBeNull();
      expect(second.walletExists()).toBe(true);
    });

    it("hears of a reset in another tab", async () => {
      const first = await tab();
      await first.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const second = await tab();
      expect(await second.unlock(PASSWORD)).toBeNull();
      second.subscribe(() => undefined);

      expect(await first.resetWallet()).toEqual({ ok: true });
      await vi.waitFor(() => expect(second.walletExists()).toBe(false));
      expect(second.isUnlocked()).toBe(false);
    });
  });

  describe("a reset", () => {
    it("says the wallet is gone only once the vault has removed it", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      window.state.refuseWrites = true;

      expect(await store.resetWallet()).toEqual({ ok: false, reason: "notRemoved" });
      expect(store.isUnlocked()).toBe(false);
      expect(store.walletExists()).toBe(true);
      expect(window.vault.peek(STORAGE_KEY)).not.toBeNull();

      window.state.refuseWrites = false;
      expect(await store.resetWallet()).toEqual({ ok: true });
      expect(store.walletExists()).toBe(false);
      expect(window.vault.peek(STORAGE_KEY)).toBeNull();
    });

    it("keeps reporting the wallet as stored while the removal is under way", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const resetting = store.resetWallet();
      expect(store.isUnlocked()).toBe(false);
      expect(store.walletExists()).toBe(true);
      expect(await resetting).toEqual({ ok: true });
      expect(store.walletExists()).toBe(false);
    });

    it("removes a previous format's record too", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      window.localStorage.setItem(LEGACY_STORAGE_KEY, V8_WALLET_JSON);
      expect(await store.resetWallet()).toEqual({ ok: true });
      expect(window.vault.peek(LEGACY_STORAGE_KEY)).toBeNull();
    });
  });

  describe("a change not yet stored", () => {
    it("is marked as saving until its write lands", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      expect(store.isSaving()).toBe(false);
      const writing = store.updateWallet(rename("on its way"));
      expect(store.isSaving()).toBe(true);
      expect(await writing).toBe(true);
      expect(store.isSaving()).toBe(false);
    });

    it("stays marked as saving, and says the save failed, while the vault refuses it", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      window.state.refuseWrites = true;
      expect(await store.updateWallet(rename("not kept"))).toBe(false);
      expect(store.isSaving()).toBe(true);
      expect(store.isSaveFailing()).toBe(true);

      window.state.refuseWrites = false;
      expect(await store.syncFromStorage()).toBe(true);
      expect(store.isSaving()).toBe(false);
      expect(store.isSaveFailing()).toBe(false);
    });
  });

  describe("old plain text phrases", () => {
    const PLAINTEXT = ["noirwire.wallet.v3", "noirwire.prototype.wallet.v7"];

    it("says when one could not be deleted, and deletes it on a later start", async () => {
      await (await tab()).storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      for (const key of PLAINTEXT) window.localStorage.setItem(key, '{"phrase":["legal"]}');

      const store = await tab();
      window.state.refuseWrites = true;
      expect(await store.unlock(PASSWORD)).toBeNull();
      expect(store.isPlaintextCleanupFailing()).toBe(true);
      for (const key of PLAINTEXT) expect(window.vault.peek(key)).not.toBeNull();

      window.state.refuseWrites = false;
      const later = await tab();
      expect(await presence(later)).toBe(true);
      await vi.waitFor(() => {
        for (const key of PLAINTEXT) expect(window.vault.peek(key)).toBeNull();
      });
      expect(later.isPlaintextCleanupFailing()).toBe(false);
    });

    it("is gone by the time an unlock answers", async () => {
      await (await tab()).storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      for (const key of PLAINTEXT) window.localStorage.setItem(key, '{"phrase":["legal"]}');
      const store = await tab();
      expect(await store.unlock(PASSWORD)).toBeNull();
      for (const key of PLAINTEXT) expect(window.vault.peek(key)).toBeNull();
      expect(store.isPlaintextCleanupFailing()).toBe(false);
    });
  });

  describe("activity from the platform", () => {
    it("restarts the idle window within it, and locks instead once it has passed", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const unlockedAt = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });

      vi.setSystemTime(unlockedAt + 10 * 60 * 1000);
      window.activity.fire();
      vi.setSystemTime(unlockedAt + 20 * 60 * 1000);
      expect(store.getPhrase()).toEqual(FIXTURE_PHRASE);

      vi.setSystemTime(unlockedAt + 36 * 60 * 1000);
      window.activity.fire();
      expect(store.isUnlocked()).toBe(false);
    });

    it("stops listening once the wallet is locked", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const subscribe = vi.spyOn(window.activity, "subscribe");
      store.lock();
      expect(await store.unlock(PASSWORD)).toBeNull();
      expect(subscribe).toHaveBeenCalledTimes(1);
      store.lock();
      window.activity.fire();
      expect(store.isUnlocked()).toBe(false);
    });
  });

  describe("the idle lock", () => {
    it("is checked against the clock when a signer is asked for, not left to a timer", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const unlockedAt = Date.now();

      // Only the clock moves, as it does across system sleep: no timer fires.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(unlockedAt + 14 * 60 * 1000);
      expect(store.getPhrase()).toEqual(FIXTURE_PHRASE);
      expect(store.isUnlocked()).toBe(true);

      vi.setSystemTime(unlockedAt + 16 * 60 * 1000);
      expect(store.isUnlocked()).toBe(true);
      expect(store.getPhrase()).toBeNull();
      expect(store.isUnlocked()).toBe(false);
      expect(store.getSnapshot()).toBeNull();
    });

    it("locks on the first check after the window has passed", async () => {
      const store = await tab();
      await store.storeNewWallet(makeWallet(), FIXTURE_PHRASE, PASSWORD);
      const unlockedAt = Date.now();

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(unlockedAt + 60 * 1000);
      expect(store.lockIfIdle()).toBe(false);
      vi.setSystemTime(unlockedAt + 15 * 60 * 1000);
      expect(store.lockIfIdle()).toBe(true);
      expect(store.isUnlocked()).toBe(false);
    });
  });
});
