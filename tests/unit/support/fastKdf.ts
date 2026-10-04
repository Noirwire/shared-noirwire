import { vi } from "vitest";
import { UNNORMALISED_VAULT_JSON, V8_WALLET_JSON, WEB_ENVELOPE_JSON } from "./walletFixtures.js";

/**
 * The salts of the records captured from real apps. A key for one of those
 * is always derived in full: they are what proves the real derivation still
 * opens what is sitting on people's devices.
 */
const CAPTURED_SALTS = new Set<string>([
  (JSON.parse(V8_WALLET_JSON) as { vault: { salt: string } }).vault.salt,
  (JSON.parse(UNNORMALISED_VAULT_JSON) as { salt: string }).salt,
  (JSON.parse(WEB_ENVELOPE_JSON) as { salt: string }).salt,
]);

type Pbkdf2 = { name: "PBKDF2"; salt: Uint8Array; iterations: number; hash: string };

function isPbkdf2(algorithm: unknown): algorithm is Pbkdf2 {
  return (
    typeof algorithm === "object" &&
    algorithm !== null &&
    (algorithm as { name?: unknown }).name === "PBKDF2"
  );
}

const quick = <T>(algorithm: T): T =>
  isPbkdf2(algorithm) && !CAPTURED_SALTS.has(Buffer.from(algorithm.salt).toString("base64"))
    ? { ...algorithm, iterations: 1 }
    : algorithm;

/**
 * Derives a wallet's key in one round instead of 600,000, at the WebCrypto
 * boundary the keystore already calls, for tests about what the store does
 * with a key and not about how hard the key is to guess. The package's own
 * code is untouched: it asks for the full count and records it. The same
 * password and salt still give the same key, a different password still
 * gives a different one, and a key for a record captured from a real app is
 * derived in full. `tests/unit/keystore.test.ts` and one round trip in each
 * store suite never use this.
 *
 * Returns what puts the real derivation back.
 */
export function fastKeyDerivation(): () => void {
  const { subtle } = crypto;
  const deriveKey = subtle.deriveKey.bind(subtle);
  const deriveBits = subtle.deriveBits.bind(subtle);
  const spies = [
    vi
      .spyOn(subtle, "deriveKey")
      .mockImplementation((algorithm, ...rest) => deriveKey(quick(algorithm), ...rest)),
    vi
      .spyOn(subtle, "deriveBits")
      .mockImplementation((algorithm, ...rest) => deriveBits(quick(algorithm), ...rest)),
  ];
  return () => spies.forEach((spy) => spy.mockRestore());
}
