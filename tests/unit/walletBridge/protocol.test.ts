import { describe, expect, it } from "vitest";
import {
  MAX_ENVELOPE_BYTES,
  decodeBase64,
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  parseToTerminal,
  parseToWallet,
} from "../../../src/domain/walletBridge/protocol.js";
import fixtures from "../../fixtures/walletBridge/messages.json" with { type: "json" };

const ID = "AQEBAQEBAQEBAQEBAQEBAQ";
const CHANNEL = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";

const signMessage = (message: string) => ({
  v: 1,
  type: "signMessage",
  id: ID,
  channel: CHANNEL,
  message,
});

const signTransaction = (message: string) => ({
  v: 1,
  type: "signTransaction",
  id: ID,
  channel: CHANNEL,
  network: "solana",
  message,
});

describe("the bridge protocol", () => {
  it.each(fixtures.toWallet.valid)("reads the terminal's $name", ({ message }) => {
    expect(parseToWallet(message).ok).toBe(true);
  });

  it.each(fixtures.toWallet.invalid)("refuses the terminal's $name", ({ message, rule }) => {
    expect(parseToWallet(message)).toEqual({ ok: false, rule });
  });

  it.each(fixtures.toTerminal.valid)("reads the wallet's $name", ({ message }) => {
    expect(parseToTerminal(message).ok).toBe(true);
  });

  it.each(fixtures.toTerminal.invalid)("refuses the wallet's $name", ({ message, rule }) => {
    expect(parseToTerminal(message)).toEqual({ ok: false, rule });
  });

  it("refuses an extra key and a version other than 1", () => {
    const valid = fixtures.toWallet.valid[3].message;
    expect(parseToWallet({ ...valid, extra: 1 })).toEqual({ ok: false, rule: "keys" });
    expect(parseToWallet({ ...valid, v: 2 })).toEqual({ ok: false, rule: "version" });
  });

  it("refuses a transaction message of 1,233 bytes and takes one of 1,232", () => {
    expect(parseToWallet(signTransaction(encodeBase64(new Uint8Array(1232).fill(7)))).ok).toBe(
      true,
    );
    expect(parseToWallet(signTransaction(encodeBase64(new Uint8Array(1233).fill(7))))).toEqual({
      ok: false,
      rule: "field",
    });
  });

  it("refuses a sign-in message of 513 bytes and takes one of 512", () => {
    expect(parseToWallet(signMessage(encodeBase64(new Uint8Array(512).fill(7)))).ok).toBe(true);
    expect(parseToWallet(signMessage(encodeBase64(new Uint8Array(513).fill(7)))).ok).toBe(false);
  });

  it("refuses base64 that does not read back as it was written", () => {
    // 'B' leaves bits set that the one byte before it does not use.
    expect(parseToWallet(signMessage("AB==")).ok).toBe(false);
    expect(parseToWallet(signMessage("AAA")).ok).toBe(false);
    expect(parseToWallet(signMessage("AA==\n")).ok).toBe(false);
    expect(decodeBase64("AAAA")).toEqual(new Uint8Array(3));
  });

  it("refuses a signature of 63 or 65 bytes and takes one of 64", () => {
    const signed = (bytes: number) => ({
      v: 1,
      type: "signed",
      id: ID,
      channel: CHANNEL,
      signature: encodeBase64(new Uint8Array(bytes).fill(4)),
    });
    expect(parseToTerminal(signed(64)).ok).toBe(true);
    expect(parseToTerminal(signed(63)).ok).toBe(false);
    expect(parseToTerminal(signed(65)).ok).toBe(false);
  });

  it("refuses a message whose JSON is over 8 KB, whatever its fields say", () => {
    const heavy = {
      ...fixtures.toWallet.valid[3].message,
      padding: "x".repeat(MAX_ENVELOPE_BYTES),
    };
    expect(parseToWallet(heavy)).toEqual({ ok: false, rule: "tooLarge" });
  });

  it("refuses what is not a plain object", () => {
    for (const value of [null, undefined, "cancel", 7, [], new Map(), new (class A {})()]) {
      expect(parseToWallet(value)).toEqual({ ok: false, rule: "notObject" });
    }
    const cyclic: Record<string, unknown> = { v: 1, type: "ready" };
    cyclic.self = cyclic;
    expect(parseToTerminal(cyclic)).toEqual({ ok: false, rule: "tooLarge" });
  });

  it("round-trips URL-safe base64 only in its canonical form", () => {
    const bytes = new Uint8Array(32).fill(0xfb);
    const text = encodeBase64Url(bytes);
    expect(text).toHaveLength(43);
    expect(text.startsWith("-_v7")).toBe(true);
    expect(decodeBase64Url(text)).toEqual(bytes);
    expect(decodeBase64Url(`${text}=`)).toBeNull();
    expect(decodeBase64Url(`+/${text.slice(2)}`)).toBeNull();
  });
});
