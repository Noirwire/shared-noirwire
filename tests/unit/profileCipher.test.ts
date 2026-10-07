import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_BYTES,
  decodeProfile,
  encodeProfile,
  mergeProfile,
  profileFieldsOf,
} from "../../src/domain/profile.js";
import { MAX_SLICES } from "../../src/domain/pie.js";
import type { Portfolio, Wallet } from "../../src/domain/wallet.js";
import { profileCipher } from "../../src/infrastructure/profileCipher.js";

const SECRET = new Uint8Array(32).map((_, index) => index + 1);
const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER_OWNER = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const TEXT = '{"v":1,"m":1,"f":{"w":[1,["SPYx"]]}}';

describe("the profile cipher", () => {
  it("opens what it sealed, and lays it out as format, nonce, ciphertext and tag", async () => {
    const sealed = await profileCipher.seal(SECRET, OWNER, TEXT);
    expect(sealed[0]).toBe(1);
    expect(sealed.length).toBe(1 + 12 + new TextEncoder().encode(TEXT).length + 16);
    expect(new TextDecoder().decode(sealed)).not.toContain("SPYx");
    expect(await profileCipher.open(SECRET, OWNER, sealed)).toBe(TEXT);
  });

  it("seals with AES-256-GCM under HKDF-SHA-256 of the secret, so another implementation opens it", async () => {
    const sealed = await profileCipher.seal(SECRET, OWNER, TEXT);
    const material = await crypto.subtle.importKey("raw", SECRET, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode("noirwire-profile-v1"),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: sealed.slice(1, 13),
        additionalData: new TextEncoder().encode(`noirwire-profile|1|${OWNER}`),
      },
      key,
      sealed.slice(13),
    );
    expect(new TextDecoder().decode(plaintext)).toBe(TEXT);
  });

  it("does not open under another secret", async () => {
    const sealed = await profileCipher.seal(SECRET, OWNER, TEXT);
    const wrong = SECRET.map((byte) => byte ^ 1);
    expect(await profileCipher.open(wrong, OWNER, sealed)).toBeNull();
  });

  it("does not open once any byte of it has changed", async () => {
    const sealed = await profileCipher.seal(SECRET, OWNER, TEXT);
    for (const at of [0, 1, 12, 13, sealed.length - 17, sealed.length - 1]) {
      const tampered = Uint8Array.from(sealed);
      tampered[at] ^= 0x01;
      expect(await profileCipher.open(SECRET, OWNER, tampered), `byte ${at}`).toBeNull();
    }
  });

  it("does not open as another owner's record", async () => {
    const sealed = await profileCipher.seal(SECRET, OWNER, TEXT);
    expect(await profileCipher.open(SECRET, OTHER_OWNER, sealed)).toBeNull();
  });

  it("never seals the same text the same way twice", async () => {
    const first = await profileCipher.seal(SECRET, OWNER, TEXT);
    const second = await profileCipher.seal(SECRET, OWNER, TEXT);
    expect(first).not.toEqual(second);
    expect(first.subarray(1, 13)).not.toEqual(second.subarray(1, 13));
  });

  it("answers null, not an error, for data too short to be a record", async () => {
    expect(await profileCipher.open(SECRET, OWNER, new Uint8Array(0))).toBeNull();
    expect(await profileCipher.open(SECRET, OWNER, Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});

describe("a full wallet's record", () => {
  const STOCKS = Array.from({ length: 40 }, (_, index) => `STK${String(index).padStart(2, "0")}x`);

  /** A wallet of `count` marked portfolios, the first `pies` of them pies of `slices` trackers. */
  function walletOf(shape: {
    count: number;
    name: string;
    pies: number;
    slices: number;
    watched: number;
  }): Wallet {
    const portfolios: Portfolio[] = Array.from({ length: shape.count }, (_, index) => ({
      id: `acc_${index}`,
      label: `${shape.name} ${index + 1}`,
      address: "unused",
      derivationIndex: index + 1,
      createdAt: 1_790_000_000_000 + index,
      archivedAt: index % 2 ? 1_790_000_900_000 + index : null,
      holdings: [],
      icon: { glyph: "graduation", tint: "neutral" },
      ...(index < shape.pies
        ? { pie: STOCKS.slice(0, shape.slices).map((symbol) => ({ symbol, weight: 10 })) }
        : {}),
    }));
    return {
      createdAt: 1,
      derivationScheme: "app",
      funding: { address: "unused", sol: 0, tokens: {} },
      portfolios,
      activity: [],
      watchlist: STOCKS.slice(0, shape.watched),
    };
  }

  const crowded = (pies: number) =>
    walletOf({
      count: 8,
      name: "A long portfolio name, number",
      pies,
      slices: MAX_SLICES,
      watched: 40,
    });

  async function sealedRecord(wallet: Wallet) {
    const { envelope } = mergeProfile({
      device: profileFieldsOf(wallet),
      synced: null,
      mirror: null,
    });
    const sealed = await profileCipher.seal(SECRET, OWNER, encodeProfile(envelope));
    expect(decodeProfile((await profileCipher.open(SECRET, OWNER, sealed))!)).toEqual(envelope);
    return sealed;
  }

  it("fits in 2048 bytes sealed: eight long-named, marked portfolios and a watchlist of forty", async () => {
    expect(await sealedRecord(crowded(0))).toHaveLength(1294);
  });

  it("still fits in 2048 when three of the eight are full pies of ten", async () => {
    expect(await sealedRecord(crowded(3))).toHaveLength(1732);
  });

  it("stays under the program's own ceiling when every one of the eight is a full pie, which 2048 does not hold", async () => {
    // About 145 bytes a full pie: eight of them is some 2500 bytes sealed.
    expect((await sealedRecord(crowded(8))).length).toBeLessThanOrEqual(MAX_PROFILE_BYTES);
  });
});
