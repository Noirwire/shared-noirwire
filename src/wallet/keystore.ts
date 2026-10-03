/**
 * Password-encrypted storage for everything the wallet keeps in this browser:
 * the recovery phrase every keypair is derived from, and the record of which
 * addresses, portfolios and activity belong to it.
 *
 * The phrase used to be written to localStorage as plain text, then encrypted
 * on its own beside a readable list of addresses. Either way a copy of the
 * browser profile told its reader something: first the keys, later which
 * addresses belong together, which is the link this product exists to break.
 * So the whole record is one ciphertext, and the stored copy is worthless
 * without something the user knows.
 *
 * AES-256-GCM over a PBKDF2-SHA256 key. WebCrypto only, no dependency.
 * Argon2id would resist a GPU better, but it is not in WebCrypto, and
 * pulling in WASM for it is a bigger change than this is worth today - the
 * iteration count below is the OWASP floor for PBKDF2-SHA256 and is the
 * knob to raise if that trade stops being acceptable.
 */

const ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

/** The only thing the wallet writes to storage. Nothing in it is readable without the password. */
export type Envelope = {
  /** Lets a future change in the parameters below be detected rather than silently mis-decrypted. */
  v: 2;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

/**
 * A derived key and the parameters it came from. PBKDF2 is slow on purpose,
 * so it runs once per unlock and the key is kept in memory for the writes
 * that follow. The key is not extractable: script can use it, not read it.
 */
export type VaultKey = {
  key: CryptoKey;
  salt: string;
  iterations: number;
};

/** The format before the whole record was encrypted: the phrase alone, beside a readable wallet. */
export type EncryptedVault = {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The same password can be typed as different bytes: a composed or decomposed
 * accent, a full-width letter from another keyboard. NFKC folds those into
 * one form, so a password set on one device still opens on another.
 */
export function normalisePassword(password: string): string {
  return password.normalize("NFKC");
}

/** A key under a fresh salt, for a new wallet or a new password. */
export async function newVaultKey(password: string): Promise<VaultKey> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return {
    key: await deriveKey(normalisePassword(password), salt, ITERATIONS),
    salt: toBase64(salt),
    iterations: ITERATIONS,
  };
}

/** The key `password` gives for an existing envelope. Whether it is the right one only `open` can say. */
export async function vaultKeyFor(envelope: Envelope, password: string): Promise<VaultKey> {
  return {
    key: await deriveKey(
      normalisePassword(password),
      fromBase64(envelope.salt),
      envelope.iterations,
    ),
    salt: envelope.salt,
    iterations: envelope.iterations,
  };
}

/**
 * Encrypts `plaintext` under an already derived key. Every call draws a new
 * random IV: GCM is broken by two messages under one key and one IV, and a
 * wallet is rewritten on every balance refresh.
 */
export async function seal(vaultKey: VaultKey, plaintext: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    vaultKey.key,
    new TextEncoder().encode(plaintext),
  );

  return {
    v: 2,
    kdf: "PBKDF2-SHA256",
    iterations: vaultKey.iterations,
    salt: vaultKey.salt,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Returns the plaintext, or null for the wrong key.
 *
 * Null rather than a thrown error because a wrong password is an ordinary
 * thing a user does, not an exceptional condition - and GCM's authentication
 * tag is what detects it, so a wrong password cannot yield plausible-looking
 * wrong contents. It fails, it does not silently produce garbage.
 */
export async function open(vaultKey: VaultKey, envelope: Envelope): Promise<string | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.iv) as BufferSource },
      vaultKey.key,
      fromBase64(envelope.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

function hasEnvelopeFields(value: unknown, version: number) {
  if (typeof value !== "object" || value === null) return false;
  const fields = value as Record<string, unknown>;
  return (
    fields.v === version &&
    fields.kdf === "PBKDF2-SHA256" &&
    typeof fields.iterations === "number" &&
    fields.iterations > 0 &&
    typeof fields.salt === "string" &&
    typeof fields.iv === "string" &&
    typeof fields.ciphertext === "string"
  );
}

export function isEnvelope(value: unknown): value is Envelope {
  return hasEnvelopeFields(value, 2);
}

export function isEncryptedVault(value: unknown): value is EncryptedVault {
  return hasEnvelopeFields(value, 1);
}

/**
 * Opens a vault of the earlier format, kept only so such a wallet can be
 * upgraded the first time it is unlocked. Those vaults were made from the
 * password exactly as typed, so the typed form is tried when the normalised
 * one does not open it.
 */
export async function decryptVault(
  vault: EncryptedVault,
  password: string,
): Promise<string[] | null> {
  const forms = [...new Set([normalisePassword(password), password])];
  for (const form of forms) {
    try {
      const key = await deriveKey(form, fromBase64(vault.salt), vault.iterations);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(vault.iv) as BufferSource },
        key,
        fromBase64(vault.ciphertext) as BufferSource,
      );
      const words = new TextDecoder().decode(plaintext).split(" ").filter(Boolean);
      if (words.length === 12 || words.length === 24) return words;
    } catch {
      /* wrong form of the password; the next one is tried */
    }
  }
  return null;
}
