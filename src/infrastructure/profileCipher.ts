import type { ProfileCipher } from "../application/ports.js";

/**
 * How a wallet's profile is sealed before it leaves the device, so the
 * server that carries it and the chain that keeps it only ever hold
 * ciphertext. AES-256-GCM under a key HKDF-SHA-256 makes from the profile's
 * secret. WebCrypto only, no dependency.
 *
 * Sealed, a profile is one format byte, a 12-byte nonce, then the
 * ciphertext and its tag. Whose profile it is, and which revision of it,
 * go in as additional data: a record copied onto another owner's account,
 * or put back in place of a later one, does not open there.
 */

const FORMAT = 1;
const NONCE_BYTES = 12;
const KEY_INFO = "noirwire-profile-v1";

const utf8 = (text: string) => new TextEncoder().encode(text);

/**
 * Derived for each use, kept nowhere, and not extractable: script can use
 * it, not read it. The salt is empty: the secret is a key already, made for
 * this alone, and both apps must derive the same one from it.
 */
async function keyFrom(secret: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", secret as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(KEY_INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The owner and the revision go in as additional data. The key proves who
 * wrote a record, not which writing of it this is: bound to its revision, an
 * older record put back under a newer one does not open.
 */
function sealing(nonce: Uint8Array, owner: string, revision: bigint) {
  return {
    name: "AES-GCM",
    iv: nonce as BufferSource,
    additionalData: utf8(`noirwire-profile|${FORMAT}|${owner}|${revision}`),
  };
}

export const profileCipher: ProfileCipher = {
  /** Every call draws a new nonce: GCM is broken by two messages under one key and one nonce. */
  async seal(secret, { owner, revision }, plaintext) {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        sealing(nonce, owner, revision),
        await keyFrom(secret),
        utf8(plaintext),
      ),
    );
    const sealed = new Uint8Array(1 + NONCE_BYTES + ciphertext.length);
    sealed[0] = FORMAT;
    sealed.set(nonce, 1);
    sealed.set(ciphertext, 1 + NONCE_BYTES);
    return sealed;
  },

  /** Null, not a thrown error: a record this app cannot open is an ordinary thing to find. */
  async open(secret, { owner, revision }, data) {
    if (data[0] !== FORMAT || data.length <= 1 + NONCE_BYTES) return null;
    try {
      const plaintext = await crypto.subtle.decrypt(
        sealing(data.subarray(1, 1 + NONCE_BYTES), owner, revision),
        await keyFrom(secret),
        data.subarray(1 + NONCE_BYTES) as BufferSource,
      );
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch {
      return null;
    }
  },
};
