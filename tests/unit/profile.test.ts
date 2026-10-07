import { describe, expect, it } from "vitest";
import {
  decodeProfile,
  encodeProfile,
  mayWriteProfile,
  mergeProfile,
  profileFieldsOf,
  withProfileChanges,
  type ProfileEnvelope,
  type ProfileField,
} from "../../src/domain/profile.js";
import type { Portfolio, Wallet } from "../../src/domain/wallet.js";

function portfolio(derivationIndex: number, over: Partial<Portfolio> = {}): Portfolio {
  return {
    id: `acc_${derivationIndex}`,
    label: `Portfolio ${derivationIndex}`,
    address: `Address${derivationIndex}`,
    derivationIndex,
    createdAt: 1_000 + derivationIndex,
    archivedAt: null,
    holdings: [{ symbol: "USDC", amount: 12, cost: 12 }],
    ...over,
  };
}

function wallet(over: Partial<Wallet> = {}): Wallet {
  return {
    createdAt: 1,
    derivationScheme: "app",
    funding: { address: "Funding", sol: 1, tokens: { USDC: 5 } },
    portfolios: [portfolio(1)],
    activity: [],
    watchlist: ["SPYx"],
    ...over,
  };
}

const envelope = (f: Record<string, ProfileField>, m = 1, v = 1): ProfileEnvelope => ({ v, m, f });
const value = (label: string, more: object = {}) => ({ l: label, c: 1_001, a: null, ...more });
const restoreNone = () => null;

/** A device's wallet and its last synced copy, synced through `mergeProfile` as the use case does. */
function device(start: Wallet) {
  const state = { wallet: start, synced: null as ProfileEnvelope | null };
  return {
    state,
    /** Syncs against `mirror` and gives back what the mirror holds afterwards. */
    sync(mirror: ProfileEnvelope | null): ProfileEnvelope | null {
      const merged = mergeProfile({
        device: profileFieldsOf(state.wallet),
        synced: state.synced,
        mirror,
      });
      state.wallet = withProfileChanges(state.wallet, merged.changes, restoreNone);
      state.synced = decodeProfile(encodeProfile(merged.envelope));
      return merged.write ? decodeProfile(encodeProfile(merged.envelope)) : mirror;
    },
    rename(label: string) {
      state.wallet = {
        ...state.wallet,
        portfolios: state.wallet.portfolios.map((entry) => ({ ...entry, label })),
      };
    },
    label: () => state.wallet.portfolios[0].label,
  };
}

describe("the labels a wallet mirrors", () => {
  it("are its portfolios' names, marks, pies and archived state and its watchlist, and nothing about money", () => {
    const fields = profileFieldsOf(
      wallet({
        portfolios: [
          portfolio(3, {
            label: "Rainy day",
            archivedAt: 77,
            icon: { glyph: "sun", tint: "ochre" },
            pie: [{ symbol: "NVDAx", weight: 100 }],
          }),
        ],
      }),
    );
    expect(fields).toEqual({
      w: ["SPYx"],
      p3: { l: "Rainy day", c: 1_003, a: 77, i: ["sun", "ochre"], s: [["NVDAx", 100]] },
    });
    expect(JSON.stringify(fields)).not.toMatch(/Address|Funding|holdings|USDC|acc_/);
  });
});

describe("the envelope", () => {
  it("comes back from its text as it went in", () => {
    const written = envelope({ w: [2, ["SPYx"]], p1: [5, value("Main")], later: [1, { any: 1 }] });
    expect(decodeProfile(encodeProfile(written))).toEqual(written);
  });

  it("is not read from text that is not one", () => {
    for (const text of ["", "not json", "[]", '{"v":1,"m":1}', '{"v":0,"m":1,"f":{}}']) {
      expect(decodeProfile(text), text).toBeNull();
    }
  });

  it("leaves out a field that is not a revision and a value", () => {
    const decoded = decodeProfile('{"v":1,"m":1,"f":{"w":[1,["SPYx"]],"bad":"x","worse":[0,1]}}');
    expect(Object.keys(decoded!.f)).toEqual(["w"]);
  });
});

describe("who may write", () => {
  it("is anyone when there is no mirror, and only a reader at or past the mirror's floor", () => {
    expect(mayWriteProfile(null)).toBe(true);
    expect(mayWriteProfile(envelope({}, 1, 4))).toBe(true);
    expect(mayWriteProfile(envelope({}, 2, 2))).toBe(false);
  });
});

describe("merging the device's labels with the mirror", () => {
  it("sends a field only the device has at revision 1", () => {
    const merged = mergeProfile({ device: profileFieldsOf(wallet()), synced: null, mirror: null });
    expect(merged.write).toBe(true);
    expect(merged.changes).toEqual([]);
    expect(merged.envelope).toEqual(envelope({ p1: [1, value("Portfolio 1")], w: [1, ["SPYx"]] }));
  });

  it("takes a field only the mirror has, without writing", () => {
    const mirror = envelope({
      p1: [1, value("Portfolio 1")],
      p4: [3, value("Trips")],
      w: [1, ["SPYx"]],
    });
    const merged = mergeProfile({ device: profileFieldsOf(wallet()), synced: mirror, mirror });
    expect(merged.write).toBe(false);
    expect(merged.changes).toEqual([{ id: "p4", seen: null, value: value("Trips") }]);
    expect(merged.envelope.f.p4).toEqual([3, value("Trips")]);
  });

  it("takes the mirror's value when the device's is as last synced and the mirror's revision is higher", () => {
    const synced = envelope({ p1: [1, value("Portfolio 1")], w: [1, ["SPYx"]] });
    const mirror = envelope({ p1: [2, value("Renamed elsewhere")], w: [1, ["SPYx"]] });
    const merged = mergeProfile({ device: profileFieldsOf(wallet()), synced, mirror });
    expect(merged.write).toBe(false);
    expect(merged.changes.map((change) => change.id)).toEqual(["p1"]);
    expect(withProfileChanges(wallet(), merged.changes, restoreNone).portfolios[0].label).toBe(
      "Renamed elsewhere",
    );
  });

  it("lets the device win when its value changed since the last sync, one past the higher revision", () => {
    const synced = envelope({ p1: [2, value("Old")], w: [1, ["SPYx"]] });
    const mirror = envelope({ p1: [6, value("Theirs")], w: [1, ["SPYx"]] });
    const mine = wallet({ portfolios: [portfolio(1, { label: "Mine" })] });
    const merged = mergeProfile({ device: profileFieldsOf(mine), synced, mirror });
    expect(merged.write).toBe(true);
    expect(merged.changes).toEqual([]);
    expect(merged.envelope.f.p1).toEqual([7, value("Mine")]);
    // The field nobody touched keeps its revision: a write does not bump what it did not change.
    expect(merged.envelope.f.w).toEqual([1, ["SPYx"]]);
  });

  it("writes nothing when the device changed to what the mirror already holds", () => {
    const synced = envelope({ p1: [2, value("Old")], w: [1, ["SPYx"]] });
    const mirror = envelope({ p1: [3, value("Same")], w: [1, ["SPYx"]] });
    const mine = wallet({ portfolios: [portfolio(1, { label: "Same" })] });
    const merged = mergeProfile({ device: profileFieldsOf(mine), synced, mirror });
    expect(merged).toMatchObject({ write: false, changes: [] });
    expect(merged.envelope.f.p1[0]).toBe(3);
  });

  it("does not take a value from a mirror whose revision is not higher, and sends its own next time", () => {
    const synced = envelope({ p1: [3, value("Portfolio 1")], w: [1, ["SPYx"]] });
    const mirror = envelope({ p1: [2, value("An older name")], w: [1, ["SPYx"]] });
    const merged = mergeProfile({ device: profileFieldsOf(wallet()), synced, mirror });
    expect(merged).toMatchObject({ write: false, changes: [] });

    const next = mergeProfile({
      device: profileFieldsOf(wallet()),
      synced: merged.envelope,
      mirror,
    });
    expect(next.write).toBe(true);
    expect(next.envelope.f.p1).toEqual([3, value("Portfolio 1")]);
  });

  it("takes the mirror's labels on a device that has never synced, which is how a restore gets them back", () => {
    const mirror = envelope({ p1: [4, value("Retirement")], w: [2, ["NVDAx", "SPYx"]] });
    const merged = mergeProfile({ device: profileFieldsOf(wallet()), synced: null, mirror });
    expect(merged.write).toBe(false);
    const restored = withProfileChanges(wallet(), merged.changes, restoreNone);
    expect(restored.portfolios[0].label).toBe("Retirement");
    expect(restored.watchlist).toEqual(["NVDAx", "SPYx"]);
  });

  it("is decided by revisions alone, whatever the times on either side say", () => {
    const synced = envelope({ p1: [1, value("Portfolio 1")], w: [1, ["SPYx"]] });
    // The mirror's value carries an older creation time and still wins: its revision is higher.
    const mirror = envelope({ p1: [2, { l: "Theirs", c: 5, a: null }], w: [1, ["SPYx"]] });
    const late = wallet({ createdAt: 9_999_999_999_999 });
    const merged = mergeProfile({ device: profileFieldsOf(late), synced, mirror });
    expect(withProfileChanges(late, merged.changes, restoreNone).portfolios[0]).toMatchObject({
      label: "Theirs",
      createdAt: 5,
    });
  });

  it("keeps a field it does not know, and writes it back unchanged", () => {
    const stranger: ProfileField = [9, { handle: "later", nested: [1, 2] }];
    const mirror = envelope({ follows: stranger, p1: [1, value("Portfolio 1")], w: [1, ["SPYx"]] });
    const mine = wallet({ watchlist: ["SPYx", "NVDAx"] });
    const merged = mergeProfile({ device: profileFieldsOf(mine), synced: mirror, mirror });
    expect(merged.write).toBe(true);
    expect(merged.envelope.f.follows).toEqual(stranger);
    expect(merged.envelope.f.w).toEqual([2, ["SPYx", "NVDAx"]]);
    expect(merged.changes).toEqual([]);
  });

  it("keeps a key a newer version put inside a portfolio's value when this one renames that portfolio", () => {
    const mirror = envelope({
      p1: [1, value("Portfolio 1", { z: { colour: "teal" } })],
      w: [1, ["SPYx"]],
    });
    const mine = wallet({ portfolios: [portfolio(1, { label: "Renamed here" })] });
    const merged = mergeProfile({ device: profileFieldsOf(mine), synced: mirror, mirror });
    expect(merged.write).toBe(true);
    expect(merged.envelope.f.p1).toEqual([2, value("Renamed here", { z: { colour: "teal" } })]);
  });

  it("does not call a value changed because a newer version added a key to it", () => {
    const mirror = envelope({ p1: [1, value("Portfolio 1", { z: 1 })], w: [1, ["SPYx"]] });
    const merged = mergeProfile({ device: profileFieldsOf(wallet()), synced: mirror, mirror });
    expect(merged).toMatchObject({ write: false, changes: [] });
  });

  it("leaves alone a value it cannot follow under a field it knows", () => {
    const odd: ProfileField = [4, { l: 12, shape: "from a later version" }];
    const mirror = envelope({ p1: odd, w: [1, ["SPYx"]] });
    const mine = wallet({ portfolios: [portfolio(1, { label: "Mine" })] });
    const merged = mergeProfile({ device: profileFieldsOf(mine), synced: null, mirror });
    expect(merged.envelope.f.p1).toEqual(odd);
    expect(merged).toMatchObject({ write: false, changes: [] });
  });

  it("reads a mirror it may not write, and keeps its own change for later", () => {
    const synced = envelope({ p1: [1, value("Portfolio 1")], w: [1, ["SPYx"]] });
    const mirror = envelope({ p1: [1, value("Portfolio 1")], w: [3, ["TSLAx"]] }, 2, 2);
    const mine = wallet({ portfolios: [portfolio(1, { label: "Mine" })] });
    const merged = mergeProfile({ device: profileFieldsOf(mine), synced, mirror });
    expect(merged.write).toBe(false);
    expect(withProfileChanges(mine, merged.changes, restoreNone)).toMatchObject({
      watchlist: ["TSLAx"],
      portfolios: [{ label: "Mine" }],
    });
    // The rename still reads as changed here once this version may write again.
    const later = mergeProfile({
      device: profileFieldsOf(withProfileChanges(mine, merged.changes, restoreNone)),
      synced: merged.envelope,
      mirror: { ...mirror, m: 1 },
    });
    expect(later.write).toBe(true);
    expect(later.envelope.f.p1).toEqual([2, value("Mine")]);
    expect(later.envelope.f.w).toEqual([3, ["TSLAx"]]);
  });

  it("writes nothing when the device and the mirror already agree", () => {
    const first = mergeProfile({ device: profileFieldsOf(wallet()), synced: null, mirror: null });
    const mirror = decodeProfile(encodeProfile(first.envelope))!;
    const again = mergeProfile({ device: profileFieldsOf(wallet()), synced: mirror, mirror });
    expect(again).toMatchObject({ write: false, changes: [] });
    expect(encodeProfile(again.envelope)).toBe(encodeProfile(first.envelope));
  });

  it("settles two devices that renamed the same portfolio on one label, and then stops writing", () => {
    const a = device(wallet());
    const b = device(wallet());
    let mirror = a.sync(null);
    mirror = b.sync(mirror);

    a.rename("From A");
    b.rename("From B");
    const writes: string[] = [];
    for (const [name, each] of [
      ["a", a],
      ["b", b],
      ["a", a],
      ["b", b],
      ["a", a],
      ["b", b],
    ] as const) {
      const next = each.sync(mirror);
      if (next !== mirror) writes.push(name);
      mirror = next;
    }
    expect(a.label()).toBe("From B");
    expect(b.label()).toBe("From B");
    // Each wrote its rename once. After that neither has anything to write, however often it syncs.
    expect(writes).toEqual(["a", "b"]);
  });
});

describe("taking the mirror's labels into the wallet", () => {
  const mirror = envelope({
    p1: [2, value("Renamed", { i: ["sun", "ochre"] })],
    p3: [
      1,
      {
        l: "Trips",
        c: 55,
        a: 60,
        s: [
          ["NVDAx", 60],
          ["SPYx", 40],
        ],
      },
    ],
    w: [1, ["SPYx"]],
  });
  const synced = envelope({ p1: [1, value("Portfolio 1")], w: [1, ["SPYx"]] });
  const merged = mergeProfile({ device: profileFieldsOf(wallet()), synced, mirror });
  const restore = (index: number, label: string) =>
    portfolio(index, { label, address: `Derived${index}`, holdings: [] });

  it("changes labels and nothing else of a portfolio the wallet has", () => {
    const next = withProfileChanges(wallet(), merged.changes, restore);
    expect(next.portfolios.find((entry) => entry.derivationIndex === 1)).toEqual(
      portfolio(1, { label: "Renamed", icon: { glyph: "sun", tint: "ochre" } }),
    );
    expect(next.funding).toEqual(wallet().funding);
  });

  it("makes a portfolio the wallet lacks at the field's index, with the address it is given and the mirror's labels", () => {
    const next = withProfileChanges(wallet(), merged.changes, restore);
    expect(next.portfolios[0]).toEqual({
      id: "acc_3",
      label: "Trips",
      address: "Derived3",
      derivationIndex: 3,
      createdAt: 55,
      archivedAt: 60,
      holdings: [],
      pie: [
        { symbol: "NVDAx", weight: 60 },
        { symbol: "SPYx", weight: 40 },
      ],
    });
  });

  it("leaves a label alone that changed on the device after the two were compared", () => {
    const renamedSince = wallet({ portfolios: [portfolio(1, { label: "Just now" })] });
    const next = withProfileChanges(renamedSince, merged.changes, restore);
    expect(next.portfolios.find((entry) => entry.derivationIndex === 1)?.label).toBe("Just now");
  });

  it("does not make the same portfolio twice when the change is applied again", () => {
    const once = withProfileChanges(wallet(), merged.changes, restore);
    const twice = withProfileChanges(once, merged.changes, restore);
    expect(twice.portfolios.filter((entry) => entry.derivationIndex === 3)).toHaveLength(1);
  });

  it("takes off a mark the mirror no longer holds", () => {
    const marked = wallet({
      portfolios: [portfolio(1, { icon: { glyph: "sun", tint: "ochre" } })],
    });
    const base = envelope({
      p1: [1, value("Portfolio 1", { i: ["sun", "ochre"] })],
      w: [1, ["SPYx"]],
    });
    const cleared = envelope({ p1: [2, value("Portfolio 1")], w: [1, ["SPYx"]] });
    const { changes } = mergeProfile({
      device: profileFieldsOf(marked),
      synced: base,
      mirror: cleared,
    });
    expect(withProfileChanges(marked, changes, restore).portfolios[0]).not.toHaveProperty("icon");
  });

  it("hands back the same wallet when there is nothing to take", () => {
    const same = wallet();
    expect(withProfileChanges(same, [], restore)).toBe(same);
  });
});
