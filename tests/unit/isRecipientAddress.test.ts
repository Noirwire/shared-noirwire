import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { isRecipientAddress } from "../../src/infrastructure/solana/address.js";

describe("isRecipientAddress", () => {
  it("accepts real Solana addresses", () => {
    // The vault program's own address, plus a few freshly generated ones -
    // real 32-byte ed25519 public keys, base58-encoded.
    expect(isRecipientAddress("5aqYNsJsmRuasaFMMWAF2s94r1bTuXZC46A6Ro9C82GY")).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      expect(isRecipientAddress(Keypair.generate().publicKey.toBase58())).toBe(true);
    }
    expect(isRecipientAddress(PublicKey.default.toBase58())).toBe(true);
  });

  it("rejects garbage strings", () => {
    expect(isRecipientAddress("")).toBe(false);
    expect(isRecipientAddress("not-an-address")).toBe(false);
    expect(isRecipientAddress("hello world")).toBe(false);
    expect(isRecipientAddress("0OIl")).toBe(false); // characters outside the base58 alphabet
  });

  it("rejects strings that pass the length check but decode to the wrong byte count", () => {
    // "z" repeated decodes to more than 32 bytes at both the 32- and
    // 44-character ends of the allowed length range.
    expect(isRecipientAddress("z".repeat(32))).toBe(false);
    expect(isRecipientAddress("z".repeat(44))).toBe(false);
  });

  it("rejects a string one character short of the minimum length", () => {
    expect(isRecipientAddress("1".repeat(31))).toBe(false);
  });
});
