/**
 * The one text this wallet signs for the trading network's sign-in: the
 * challenge the rollup's query filter issues, "Login to Query Filtering
 * Service\nTimestamp: <unix seconds>\nUser: <address>". A signature on it
 * lets the signer read the account's private data for 30 days, and moves no
 * money, so it is signed only when it is exactly that text, naming the
 * account the terminal is connected to, and fresh.
 */

/** How old a challenge may be. It is fetched just before it is signed, so a wider window only helps a replay. */
export const SIGN_IN_MAX_AGE_SECONDS = 120;
/** How far ahead of this device's clock a challenge may be dated. */
export const SIGN_IN_MAX_AHEAD_SECONDS = 30;

const CHALLENGE = /^Login to Query Filtering Service\nTimestamp: (\d{1,16})\nUser: (\S+)$/;

export type SignInCheck =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "notText" | "notChallenge" | "otherUser" | "tooOld" | "tooNew" };

/**
 * Whether `message` is a fresh sign-in challenge for `address`. `nowMs` is
 * handed in: this rule never reads a clock itself.
 */
export function checkSignIn(message: Uint8Array, address: string, nowMs: number): SignInCheck {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(message);
  } catch {
    return { ok: false, reason: "notText" };
  }
  const match = CHALLENGE.exec(text);
  if (match === null) return { ok: false, reason: "notChallenge" };
  if (match[2] !== address) return { ok: false, reason: "otherUser" };
  const timestamp = Number(match[1]);
  const now = Math.floor(nowMs / 1000);
  if (timestamp < now - SIGN_IN_MAX_AGE_SECONDS) return { ok: false, reason: "tooOld" };
  if (timestamp > now + SIGN_IN_MAX_AHEAD_SECONDS) return { ok: false, reason: "tooNew" };
  return { ok: true, timestamp };
}
