import { describe, expect, it } from "vitest";
import { checkSignIn } from "../../../src/domain/walletBridge/signIn.js";

const ADDRESS = "11111111111111111111111111111112";
const NOW_SECONDS = 1_750_000_000;
const NOW_MS = NOW_SECONDS * 1000 + 500;

const challenge = (timestamp: number, user = ADDRESS, tail = "") =>
  new TextEncoder().encode(
    `Login to Query Filtering Service\nTimestamp: ${timestamp}\nUser: ${user}${tail}`,
  );

describe("the sign-in check", () => {
  it("takes the exact challenge inside the window", () => {
    expect(checkSignIn(challenge(NOW_SECONDS), ADDRESS, NOW_MS)).toEqual({
      ok: true,
      timestamp: NOW_SECONDS,
    });
    expect(checkSignIn(challenge(NOW_SECONDS - 120), ADDRESS, NOW_MS).ok).toBe(true);
    expect(checkSignIn(challenge(NOW_SECONDS + 30), ADDRESS, NOW_MS).ok).toBe(true);
  });

  it("refuses a challenge 121 seconds old", () => {
    expect(checkSignIn(challenge(NOW_SECONDS - 121), ADDRESS, NOW_MS)).toEqual({
      ok: false,
      reason: "tooOld",
    });
  });

  it("refuses a challenge dated 31 seconds ahead", () => {
    expect(checkSignIn(challenge(NOW_SECONDS + 31), ADDRESS, NOW_MS)).toEqual({
      ok: false,
      reason: "tooNew",
    });
  });

  it("refuses a challenge that names another account", () => {
    const other = "11111111111111111111111111111113";
    expect(checkSignIn(challenge(NOW_SECONDS, other), ADDRESS, NOW_MS)).toEqual({
      ok: false,
      reason: "otherUser",
    });
  });

  it("refuses a trailing newline, a carriage return and any other text", () => {
    for (const tail of ["\n", "\r", " ", "\nextra"]) {
      expect(checkSignIn(challenge(NOW_SECONDS, ADDRESS, tail), ADDRESS, NOW_MS).ok).toBe(false);
    }
    const crlf = new TextEncoder().encode(
      `Login to Query Filtering Service\r\nTimestamp: ${NOW_SECONDS}\r\nUser: ${ADDRESS}`,
    );
    expect(checkSignIn(crlf, ADDRESS, NOW_MS).ok).toBe(false);
    expect(
      checkSignIn(new TextEncoder().encode("Sign in to another site"), ADDRESS, NOW_MS),
    ).toEqual({
      ok: false,
      reason: "notChallenge",
    });
  });

  it("refuses bytes that are not UTF-8", () => {
    expect(checkSignIn(Uint8Array.of(0xff, 0xfe, 0x80), ADDRESS, NOW_MS)).toEqual({
      ok: false,
      reason: "notText",
    });
  });
});
