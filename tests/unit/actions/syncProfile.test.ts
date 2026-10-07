import { describe, expect, it, vi } from "vitest";
import { nextDerivationIndex } from "../../../src/application/actions/createPortfolio.js";
import {
  PROFILE_SYNC_TRIES,
  profileSyncBoard,
  profileSyncer,
  syncProfile,
  type ProfileSyncDeps,
} from "../../../src/application/actions/syncProfile.js";
import type {
  MirrorSending,
  MirroredProfile,
  ProfileMirror,
} from "../../../src/application/ports.js";
import type { Portfolio, Wallet } from "../../../src/domain/wallet.js";
import { profileCipher } from "../../../src/infrastructure/profileCipher.js";
import {
  FUNDING_ADDRESS,
  OTHER_ADDRESS,
  OWN_ADDRESS,
  harness,
  portfolio,
  wallet,
  type FakeSigner,
} from "../support/actions.js";

/** The secret and owner the support harness hands every session: one phrase, on every device. */
const SECRET = new Uint8Array(32).fill(7);
const OWNER = "Profile111";
const at = (revision: bigint, owner = OWNER) => ({ owner, revision });

const newPortfolio = (label: string, address: string, derivationIndex: number): Portfolio => ({
  id: `new_${derivationIndex}`,
  label,
  address,
  derivationIndex,
  createdAt: 2,
  archivedAt: null,
  holdings: [],
});

/** A mirror in memory that keeps the program's rules: one record, written only at the revision read. */
function fakeMirror() {
  const mirror = {
    limits: { maxDataLen: 2048 } as { maxDataLen: number } | null,
    limitsFail: false,
    /** While set, the server does not answer whether it keeps mirrors until this settles. */
    limitsHang: undefined as Promise<void> | undefined,
    unreachable: false,
    writesFail: false,
    account: null as MirroredProfile | null,
    reads: 0,
    writes: [] as ("create" | "write")[],
    sendings: [] as MirrorSending[],
    /** Runs between a sync's read and its write landing, as another device would. */
    beforeWrite: undefined as (() => void | Promise<void>) | undefined,
    afterRead: undefined as (() => void | Promise<void>) | undefined,
    async text() {
      const { account } = mirror;
      return account && profileCipher.open(SECRET, at(account.revision), account.data);
    },
    async labels() {
      const text = await mirror.text();
      return text === null
        ? null
        : (JSON.parse(text) as { f: Record<string, [number, unknown]> }).f;
    },
  };
  async function landing(kind: "create" | "write", sending: MirrorSending) {
    mirror.sendings.push(sending);
    const hook = mirror.beforeWrite;
    mirror.beforeWrite = undefined;
    await hook?.();
    if (mirror.writesFail) throw new Error("fetch failed");
    return kind;
  }
  const port: ProfileMirror<FakeSigner> = {
    async limits() {
      await mirror.limitsHang;
      if (mirror.limitsFail) throw new Error("fetch failed");
      return mirror.limits;
    },
    async read() {
      mirror.reads += 1;
      if (mirror.unreachable) throw new Error("fetch failed");
      const read = mirror.account && { ...mirror.account };
      await mirror.afterRead?.();
      return read;
    },
    async create(_owner, data, sending) {
      await landing("create", sending);
      if (mirror.account) return "stale";
      mirror.account = { revision: 1n, data };
      mirror.writes.push("create");
      return "written";
    },
    async write(_owner, expectedRevision, data, sending) {
      await landing("write", sending);
      if (mirror.account?.revision !== expectedRevision) return "stale";
      mirror.account = { revision: expectedRevision + 1n, data };
      mirror.writes.push("write");
      return "written";
    },
  };
  return Object.assign(mirror, { port });
}

type Mirror = ReturnType<typeof fakeMirror>;

/** One device: its own wallet and store, over a mirror it may share with another. */
function device(mirror: Mirror, initial: Wallet = wallet()) {
  const h = harness(initial);
  const board = profileSyncBoard();
  /** Every status a subscriber was told of, in order. */
  const told: (string | undefined)[] = [];
  board.subscribe(() => told.push(board.get()?.kind));
  const deps: ProfileSyncDeps<FakeSigner> = {
    session: h.deps.session,
    store: h.store,
    track: h.track,
    mirror: mirror.port,
    cipher: profileCipher,
    newPortfolio,
    status: board,
  };
  const rename = (id: string, label: string) =>
    h.store.update((current) => ({
      ...current,
      portfolios: current.portfolios.map((entry) =>
        entry.id === id ? { ...entry, label } : entry,
      ),
    }));
  return { h, deps, sync: () => syncProfile(deps), rename, wallet: h.wallet, board, told };
}

/** A wallet as an import leaves it: the one portfolio it found, under the name it gives every first one. */
const restoredFromPhrase = () =>
  wallet({ portfolios: [portfolio({ label: "Portfolio 1" })], watchlist: ["NVDAx", "SPYx"] });

describe("syncing a wallet's labels with their mirror", () => {
  it("makes the mirror from the device's labels the first time, sealed, with no address or balance in it", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    expect(await a.sync()).toEqual({ kind: "synced", wrote: true });
    expect(mirror.writes).toEqual(["create"]);

    expect(new TextDecoder().decode(mirror.account!.data)).not.toContain("Main");
    const text = (await mirror.text())!;
    expect(JSON.parse(text).f).toEqual({
      p1: [1, { l: "Main", c: 1, a: null }],
      p2: [1, { l: "Old", c: 1, a: 5 }],
      w: [1, []],
    });
    for (const secret of [OWN_ADDRESS, OTHER_ADDRESS, FUNDING_ADDRESS, "USDC", "50"]) {
      expect(text).not.toContain(secret);
    }
    // Every address of the wallet is handed over as one the write may not name.
    expect(mirror.sendings[0].keepOut.sort()).toEqual(
      [FUNDING_ADDRESS, OWN_ADDRESS, OTHER_ADDRESS].sort(),
    );
    expect(a.h.track).toHaveBeenCalledWith("profile_synced");
  });

  it("brings a freshly restored device its names and its missing portfolios, each at its own index with the session's address", async () => {
    const mirror = fakeMirror();
    const a = device(
      mirror,
      wallet({
        portfolios: [
          portfolio({
            id: "p5",
            label: "Trips",
            address: "Portfolio555",
            derivationIndex: 5,
            createdAt: 40,
            icon: { glyph: "airplane", tint: "teal" },
            pie: [
              { symbol: "NVDAx", weight: 70 },
              { symbol: "SPYx", weight: 30 },
            ],
          }),
          ...wallet().portfolios,
        ],
        watchlist: ["TSLAx"],
      }),
    );
    await a.sync();

    const b = device(mirror, restoredFromPhrase());
    expect(await b.sync()).toEqual({ kind: "synced", wrote: false });
    expect(mirror.writes).toEqual(["create"]);

    const restored = b.wallet();
    expect(restored.watchlist).toEqual(["TSLAx"]);
    expect(restored.portfolios.map((entry) => entry.derivationIndex)).toEqual([5, 2, 1]);
    // The one it had keeps its address and what it holds, and takes the name.
    expect(restored.portfolios[2]).toEqual(portfolio({ label: "Main" }));
    expect(restored.portfolios[1]).toEqual({
      id: "new_2",
      label: "Old",
      address: "Derived2",
      derivationIndex: 2,
      createdAt: 1,
      archivedAt: 5,
      holdings: [],
    });
    expect(restored.portfolios[0]).toEqual({
      id: "new_5",
      label: "Trips",
      address: "Derived5",
      derivationIndex: 5,
      createdAt: 40,
      archivedAt: null,
      holdings: [],
      icon: { glyph: "airplane", tint: "teal" },
      pie: [
        { symbol: "NVDAx", weight: 70 },
        { symbol: "SPYx", weight: 30 },
      ],
    });
  });

  it("writes nothing on a second sync of a wallet that has not changed, to the mirror or to the wallet", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    await a.sync();
    const sealed = mirror.account!.data;
    const before = a.wallet();
    a.h.track.mockClear();

    expect(await a.sync()).toEqual({ kind: "synced", wrote: false });
    expect(await a.sync()).toEqual({ kind: "synced", wrote: false });
    expect(mirror.writes).toEqual(["create"]);
    expect(mirror.account).toEqual({ revision: 1n, data: sealed });
    expect(a.wallet()).toBe(before);
    expect(a.h.track).not.toHaveBeenCalled();
  });

  it("reads again when the mirror moved under it, and ends with both devices' changes in it", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    const b = device(mirror);
    await a.sync();
    await b.sync();

    await a.rename("p1", "Renamed on A");
    await b.h.store.update((current) => ({ ...current, watchlist: ["SPYx"] }));
    mirror.reads = 0;
    // B's write lands between A's read and A's write.
    mirror.beforeWrite = async () => void (await b.sync());

    expect(await a.sync()).toEqual({ kind: "synced", wrote: true });
    expect(await mirror.labels()).toMatchObject({
      p1: [2, { l: "Renamed on A" }],
      w: [2, ["SPYx"]],
    });
    expect(mirror.account!.revision).toBe(3n);
    expect(a.wallet().watchlist).toEqual(["SPYx"]);
    await b.sync();
    expect(b.wallet().portfolios[0].label).toBe("Renamed on A");
  });

  it("gives up after a bounded number of tries on a mirror that never stands still", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    await a.sync();
    await a.rename("p1", "Mine");
    const before = a.wallet();
    mirror.reads = 0;
    // Another device writes the same labels again, each time this one has just read.
    mirror.afterRead = async () => {
      const revision = mirror.account!.revision + 1n;
      const data = await profileCipher.seal(SECRET, at(revision), (await mirror.text())!);
      mirror.account = { revision, data };
    };

    expect(await a.sync()).toEqual({ kind: "failed", stage: "conflict" });
    expect(mirror.reads).toBe(PROFILE_SYNC_TRIES);
    expect(a.wallet()).toBe(before);
    expect(a.h.track).toHaveBeenCalledWith("profile_sync_failed", { stage: "conflict" });
  });

  it("settles two devices that renamed the same portfolio on one name, and then stops writing", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    const b = device(mirror);
    await a.sync();
    await b.sync();
    await a.rename("p1", "From A");
    await b.rename("p1", "From B");
    mirror.writes.length = 0;

    for (const each of [a, b, a, b]) await each.sync();
    expect(a.wallet().portfolios[0].label).toBe("From B");
    expect(b.wallet().portfolios[0].label).toBe("From B");
    expect(mirror.writes).toEqual(["write", "write"]);

    for (const each of [a, b, a, b])
      expect(await each.sync()).toEqual({ kind: "synced", wrote: false });
    expect(mirror.writes).toHaveLength(2);
  });
});

describe("a sync that cannot finish", () => {
  /** A device that has something to take from the mirror, and something of its own to send. */
  async function midway() {
    const mirror = fakeMirror();
    const other = device(mirror);
    await other.sync();
    const a = device(mirror);
    await a.sync();
    await other.rename("p1", "Renamed elsewhere");
    await other.sync();
    await a.h.store.update((current) => ({ ...current, watchlist: ["SPYx"] }));
    const before = a.wallet();
    const sealed = mirror.account!;
    a.h.track.mockClear();
    mirror.writes.length = 0;
    return { mirror, a, before, sealed, unchanged: () => JSON.stringify(a.wallet()) };
  }

  it("leaves the wallet byte for byte as it was when the mirror cannot be reached, and counts it", async () => {
    const { mirror, a, before } = await midway();
    const stored = JSON.stringify(before);
    mirror.unreachable = true;
    expect(await a.sync()).toEqual({ kind: "failed", stage: "read" });
    expect(a.wallet()).toBe(before);
    expect(JSON.stringify(a.wallet())).toBe(stored);
    expect(a.h.track.mock.calls).toEqual([["profile_sync_failed", { stage: "read" }]]);
  });

  it("takes nothing from the mirror into the wallet when its own write does not land", async () => {
    const { mirror, a, before, sealed } = await midway();
    mirror.writesFail = true;
    expect(await a.sync()).toEqual({ kind: "failed", stage: "write" });
    expect(a.wallet()).toBe(before);
    expect(mirror.account).toBe(sealed);

    // The next one starts from the same place and gets both through.
    mirror.writesFail = false;
    expect(await a.sync()).toEqual({ kind: "synced", wrote: true });
    expect(a.wallet().portfolios[0].label).toBe("Renamed elsewhere");
    expect(await mirror.labels()).toMatchObject({ w: [2, ["SPYx"]] });
  });

  it("does nothing at all, and counts nothing, while the server says it keeps no mirrors", async () => {
    const { mirror, a, before } = await midway();
    mirror.limits = null;
    mirror.reads = 0;
    expect(await a.sync()).toEqual({ kind: "off" });
    expect(mirror.reads).toBe(0);
    expect(mirror.writes).toEqual([]);
    expect(a.wallet()).toBe(before);
    expect(a.h.track).not.toHaveBeenCalled();
  });

  it("counts one failure, and does nothing else, when the server cannot be asked whether it keeps mirrors", async () => {
    const { mirror, a, before } = await midway();
    mirror.limitsFail = true;
    mirror.reads = 0;
    mirror.sendings.length = 0;
    expect(await a.sync()).toEqual({ kind: "failed", stage: "config" });
    // Nothing was read, so no challenge was signed, and nothing was sent to be signed for.
    expect(mirror.reads).toBe(0);
    expect(mirror.sendings).toEqual([]);
    expect(mirror.writes).toEqual([]);
    expect(a.wallet()).toBe(before);
    expect(a.h.track.mock.calls).toEqual([["profile_sync_failed", { stage: "config" }]]);
  });

  it("writes nothing, to the mirror or the wallet, once the wallet locks part way", async () => {
    const { mirror, a, before, sealed } = await midway();
    mirror.afterRead = () => a.h.lock();
    expect(await a.sync()).toMatchObject({ kind: "refused", reason: "walletLocked" });
    expect(mirror.writes).toEqual([]);
    expect(mirror.account).toBe(sealed);
    expect(a.wallet()).toBe(before);
    expect(a.h.track).not.toHaveBeenCalled();
  });

  it("reads nothing while the wallet is locked", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    a.h.lock();
    expect(await a.sync()).toMatchObject({ kind: "refused", reason: "walletLocked" });
    expect(mirror.reads).toBe(0);
  });

  it.each([
    [
      "is not a record at all",
      async () => Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    ],
    [
      "was sealed under another secret",
      () => profileCipher.seal(new Uint8Array(32).fill(8), at(9n), '{"v":1,"m":1,"f":{}}'),
    ],
    [
      "was sealed for another owner",
      () => profileCipher.seal(SECRET, at(9n, "Somebody222"), '{"v":1,"m":1,"f":{"w":[9,[]]}}'),
    ],
    [
      "was sealed for another revision",
      () => profileCipher.seal(SECRET, at(8n), '{"v":1,"m":1,"f":{"w":[9,["TSLAx"]]}}'),
    ],
    [
      "opens to something that is no envelope",
      () => profileCipher.seal(SECRET, at(9n), '["not","one"]'),
    ],
    ["is larger than a record can be", async () => new Uint8Array(4097).fill(1)],
  ])("neither follows nor writes over a mirror that %s", async (_what, data) => {
    const { mirror, a, before } = await midway();
    mirror.account = { revision: 9n, data: await data() };
    const found = mirror.account;
    expect(await a.sync()).toEqual({ kind: "failed", stage: "unreadable" });
    expect(a.wallet()).toBe(before);
    expect(mirror.account).toBe(found);
    expect(mirror.writes).toEqual([]);
  });

  it("changes nothing on the device for an older record put back under a newer revision", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    const b = device(mirror);
    await a.sync();
    const old = mirror.account!.data;
    await b.sync();
    await a.rename("p1", "Renamed since");
    await a.sync();
    await b.sync();
    expect(b.wallet().portfolios[0].label).toBe("Renamed since");

    // A genuine record of this owner's, under this owner's key: only the revision is wrong.
    mirror.account = { revision: mirror.account!.revision + 1n, data: old };
    const found = mirror.account;
    const before = b.wallet();
    mirror.writes.length = 0;
    expect(await b.sync()).toEqual({ kind: "failed", stage: "unreadable" });
    expect(b.wallet()).toBe(before);
    expect(mirror.account).toBe(found);
    expect(mirror.writes).toEqual([]);
  });

  it("leaves nothing counted as synced when the wallet's own write does not reach storage", async () => {
    const mirror = fakeMirror();
    const other = device(mirror);
    await other.sync();
    const a = device(mirror, restoredFromPhrase());
    const before = a.wallet();
    const working = a.deps.store;
    a.deps.store = { ...working, update: async () => false };

    expect(await a.sync()).toEqual({ kind: "failed", stage: "save" });
    expect(a.h.track.mock.calls).toEqual([["profile_sync_failed", { stage: "save" }]]);
    expect(a.wallet()).toBe(before);
    expect(a.wallet()).not.toHaveProperty("syncedProfile");

    // Storage back, the next sync starts from what is really kept and gets the labels in.
    a.deps.store = working;
    expect(await a.sync()).toEqual({ kind: "synced", wrote: false });
    const labels = a.wallet().portfolios.map((entry) => entry.label);
    expect(labels.sort()).toEqual(["Main", "Old"]);
    expect(a.wallet().syncedProfile).toBe(await mirror.text());
  });

  it("does not regain a portfolio it took off, takes it off the mirror, and a fresh device still restores the rest", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    await a.sync();
    await a.h.store.update((current) => ({
      ...current,
      portfolios: current.portfolios.filter((entry) => entry.id !== "p2"),
    }));

    expect(await a.sync()).toEqual({ kind: "synced", wrote: true });
    expect(Object.keys((await mirror.labels())!)).toEqual(["p1", "w"]);
    expect(a.wallet().portfolios.map((entry) => entry.id)).toEqual(["p1"]);
    expect(await a.sync()).toEqual({ kind: "synced", wrote: false });
    expect(a.wallet().portfolios.map((entry) => entry.id)).toEqual(["p1"]);

    const b = device(mirror, wallet({ portfolios: [] }));
    await b.sync();
    expect(b.wallet().portfolios).toEqual([
      { ...newPortfolio("Main", "Derived1", 1), createdAt: 1, archivedAt: null },
    ]);
  });

  it("makes no portfolio of an index a mirror has no business naming, and the next one made is still the next", async () => {
    const mirror = fakeMirror();
    const far =
      '{"v":1,"m":1,"f":{"p999999999":[1,{"l":"Far","c":1,"a":null}],"p101":[1,{"l":"Past","c":1,"a":null}],"w":[1,[]]}}';
    mirror.account = { revision: 4n, data: await profileCipher.seal(SECRET, at(4n), far) };
    const a = device(mirror);
    const next = nextDerivationIndex(a.wallet(), 0);

    expect(await a.sync()).toEqual({ kind: "synced", wrote: true });
    expect(a.wallet().portfolios.map((entry) => entry.derivationIndex)).toEqual([1, 2]);
    expect(nextDerivationIndex(a.wallet(), 0)).toBe(next);
    // Kept in the mirror as they came, beside this device's own.
    expect(Object.keys((await mirror.labels())!)).toEqual(["p1", "p101", "p2", "p999999999", "w"]);
  });

  it("does not send a record the server would not hold", async () => {
    const mirror = fakeMirror();
    mirror.limits = { maxDataLen: 64 };
    const a = device(mirror);
    expect(await a.sync()).toEqual({ kind: "failed", stage: "too_large" });
    expect(mirror.account).toBeNull();
    expect(a.wallet()).not.toHaveProperty("syncedProfile");
  });

  it("syncs a wallet of eight long-named portfolios and forty watched, well past what one small transaction held", async () => {
    const mirror = fakeMirror();
    const crowded = wallet({
      portfolios: Array.from({ length: 8 }, (_, index) =>
        portfolio({
          id: `p${index + 1}`,
          label: `A long portfolio name, number ${index + 1}`,
          address: `Portfolio${index + 1}`,
          derivationIndex: index + 1,
          createdAt: 1_790_000_000_000 + index,
          icon: { glyph: "graduation", tint: "neutral" },
        }),
      ),
      watchlist: Array.from({ length: 40 }, (_, index) => `STK${index + 10}x`),
    });
    const a = device(mirror, crowded);
    expect(await a.sync()).toEqual({ kind: "synced", wrote: true });
    expect(mirror.account!.data.length).toBeGreaterThan(1_232);
    expect(mirror.account!.data.length).toBeLessThanOrEqual(2_048);

    const b = device(mirror, restoredFromPhrase());
    await b.sync();
    const labels = (of: Wallet) => of.portfolios.map((entry) => entry.label).sort();
    expect(labels(b.wallet())).toEqual(labels(crowded));
    expect(b.wallet().watchlist).toHaveLength(40);
  });

  it("reads a mirror a newer version wrote, and writes nothing to it", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    await a.sync();
    const newer =
      '{"v":2,"m":2,"f":{"p1":[4,{"l":"From the future","c":1,"a":null,"z":1}],"w":[1,[]]}}';
    mirror.account = { revision: 5n, data: await profileCipher.seal(SECRET, at(5n), newer) };
    const sealed = mirror.account;
    await a.h.store.update((current) => ({ ...current, watchlist: ["SPYx"] }));
    mirror.writes.length = 0;

    expect(await a.sync()).toEqual({ kind: "synced", wrote: false });
    expect(mirror.account).toBe(sealed);
    expect(a.wallet().portfolios[0].label).toBe("From the future");
    expect(a.wallet().watchlist).toEqual(["SPYx"]);
  });
});

describe("how a sync says it stands", () => {
  it("says nothing before a first sync, then backing up, then backed up and when", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    expect(a.board.get()).toBeNull();
    const started = Date.now();
    await a.sync();
    expect(a.told).toEqual(["syncing", "synced"]);
    const status = a.board.get();
    expect(status?.kind).toBe("synced");
    expect(status?.kind === "synced" && status.at).toBeGreaterThanOrEqual(started);
  });

  it("confirms backed up again after a sync that had nothing to change", async () => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      const mirror = fakeMirror();
      const a = device(mirror);
      await a.sync();
      vi.setSystemTime(9_000);
      expect(await a.sync()).toEqual({ kind: "synced", wrote: false });
      expect(a.board.get()).toEqual({ kind: "synced", at: 9_000 });
      expect(a.told).toEqual(["syncing", "synced", "syncing", "synced"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is backing up for as long as a sync is in flight", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    let during: string | undefined;
    mirror.beforeWrite = () => void (during = a.board.get()?.kind);
    await a.sync();
    expect(during).toBe("syncing");
  });

  it("is not backed up yet after a write that failed, and backed up once one gets through", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    mirror.writesFail = true;
    await a.sync();
    expect(a.board.get()).toEqual({ kind: "behind" });
    mirror.writesFail = false;
    await a.sync();
    expect(a.told).toEqual(["syncing", "behind", "syncing", "synced"]);
  });

  it("is off, and tells a subscriber once, while the server says it keeps no mirrors", async () => {
    const mirror = fakeMirror();
    mirror.limits = null;
    const a = device(mirror);
    await a.sync();
    await a.sync();
    expect(a.board.get()).toEqual({ kind: "off" });
    expect(a.told).toEqual(["off"]);
  });

  it("is off when the server could not be asked and was never known to keep mirrors", async () => {
    const mirror = fakeMirror();
    mirror.limitsFail = true;
    const a = device(mirror);
    await a.sync();
    expect(a.board.get()).toEqual({ kind: "off" });
  });

  it("is not backed up yet when the server cannot be asked after it was known to keep mirrors", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    await a.sync();
    mirror.limitsFail = true;
    await a.sync();
    expect(a.board.get()).toEqual({ kind: "behind" });
    expect(a.told).toEqual(["syncing", "synced", "syncing", "behind"]);
  });

  it("stops saying backed up the moment a new sync starts, however long the server takes to answer", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    await a.sync();
    await a.rename("p1", "Only on this device so far");
    let answer: () => void = () => undefined;
    mirror.limitsHang = new Promise<void>((resolve) => (answer = resolve));

    const running = a.sync();
    await Promise.resolve();
    expect(a.board.get()).toEqual({ kind: "syncing" });

    answer();
    expect(await running).toEqual({ kind: "synced", wrote: true });
    expect(a.board.get()?.kind).toBe("synced");
    expect(a.told).toEqual(["syncing", "synced", "syncing", "synced"]);
  });

  it("says backing up at once after a failure too, and off if the server then says it keeps no mirrors", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    mirror.writesFail = true;
    await a.sync();
    mirror.limits = null;
    await a.sync();
    expect(a.told).toEqual(["syncing", "behind", "syncing", "off"]);
  });

  it("says nothing while the server has yet to answer and was never known to keep mirrors", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    let answer: () => void = () => undefined;
    mirror.limitsHang = new Promise<void>((resolve) => (answer = resolve));

    const running = a.sync();
    await Promise.resolve();
    expect(a.board.get()).toBeNull();
    expect(a.told).toEqual([]);

    mirror.limits = null;
    answer();
    await running;
    // Off from the start: at no point was anything shown.
    expect(a.told).toEqual(["off"]);
  });

  it("is off for a mirror this version may read and not write", async () => {
    const mirror = fakeMirror();
    const newer = '{"v":2,"m":2,"f":{"w":[1,[]]}}';
    mirror.account = { revision: 5n, data: await profileCipher.seal(SECRET, at(5n), newer) };
    const a = device(mirror);
    await a.sync();
    expect(a.board.get()).toEqual({ kind: "off" });
  });

  it("goes back to nothing when it is reset, and tells a subscriber only if it had something", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    a.board.reset();
    expect(a.told).toEqual([]);
    await a.sync();
    a.board.reset();
    expect(a.board.get()).toBeNull();
    expect(a.told).toEqual(["syncing", "synced", undefined]);
  });
});

describe("the syncer an app calls", () => {
  it("never runs two at once, and runs once more for a call that came while one was under way", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    let running = 0;
    let most = 0;
    let release: () => void = () => undefined;
    const read = mirror.port.read;
    mirror.port.read = async (...args) => {
      running += 1;
      most = Math.max(most, running);
      if (mirror.reads === 0) await new Promise<void>((resolve) => (release = resolve));
      running -= 1;
      return read(...args);
    };
    const sync = profileSyncer(a.deps);

    const first = sync();
    await Promise.resolve();
    const second = sync();
    const third = sync();
    await a.rename("p1", "Changed meanwhile");
    release();
    await Promise.all([first, second, third]);

    expect(most).toBe(1);
    expect(mirror.reads).toBe(2);
    expect(mirror.writes).toEqual(["create"]);
    expect(await mirror.labels()).toMatchObject({ p1: [1, { l: "Changed meanwhile" }] });
  });

  it("never rejects, whatever the sync under it does", async () => {
    const mirror = fakeMirror();
    const a = device(mirror);
    a.deps.store = { ...a.deps.store, serialised: () => Promise.reject(new Error("no locks")) };
    await expect(profileSyncer(a.deps)()).resolves.toBeUndefined();
  });
});
