import { describe, expect, it } from "vitest";
import {
  decryptVault,
  isEncryptedVault,
  isEnvelope,
  newVaultKey,
  open,
  seal,
  vaultKeyFor,
} from "../../src/wallet/keystore.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_PHRASE,
  UNNORMALISED_PASSWORD,
  UNNORMALISED_VAULT_JSON,
  V8_WALLET_JSON,
} from "./support/walletFixtures.js";

const PASSWORD = "correct-horse-battery";
const SECRET = JSON.stringify({ phrase: FIXTURE_PHRASE, note: "funding address goes here" });

describe("seal / open", () => {
  it("round-trips through the right password", async () => {
    const envelope = await seal(await newVaultKey(PASSWORD), SECRET);
    expect(await open(await vaultKeyFor(envelope, PASSWORD), envelope)).toBe(SECRET);
  });

  it("returns null for the wrong password rather than plausible wrong contents", async () => {
    const envelope = await seal(await newVaultKey(PASSWORD), SECRET);
    for (const wrong of ["not-the-password", "", PASSWORD + "x"]) {
      expect(await open(await vaultKeyFor(envelope, wrong), envelope)).toBeNull();
    }
  });

  it("leaks nothing of the plaintext into the stored envelope", async () => {
    const serialized = JSON.stringify(await seal(await newVaultKey(PASSWORD), SECRET));
    for (const word of FIXTURE_PHRASE) expect(serialized).not.toContain(`"${word}"`);
    expect(serialized).not.toContain("funding address");
  });

  it("draws a fresh IV for every write under the same key", async () => {
    const key = await newVaultKey(PASSWORD);
    const envelopes = await Promise.all(Array.from({ length: 20 }, () => seal(key, SECRET)));
    expect(new Set(envelopes.map((envelope) => envelope.iv)).size).toBe(20);
    expect(new Set(envelopes.map((envelope) => envelope.ciphertext)).size).toBe(20);
    // One key, one salt: no write re-ran the key derivation.
    expect(new Set(envelopes.map((envelope) => envelope.salt)).size).toBe(1);
    for (const envelope of envelopes) expect(await open(key, envelope)).toBe(SECRET);
  });

  it("uses a different salt for every new key", async () => {
    const [a, b] = await Promise.all([newVaultKey(PASSWORD), newVaultKey(PASSWORD)]);
    expect(a.salt).not.toBe(b.salt);
  });

  it("rejects a tampered ciphertext instead of returning damaged output", async () => {
    const key = await newVaultKey(PASSWORD);
    const envelope = await seal(key, SECRET);
    const flipped =
      (envelope.ciphertext.startsWith("A") ? "B" : "A") + envelope.ciphertext.slice(1);
    expect(await open(key, { ...envelope, ciphertext: flipped })).toBeNull();
  });

  it("keeps the key itself out of reach of script", async () => {
    const { key } = await newVaultKey(PASSWORD);
    expect(key.extractable).toBe(false);
  });

  it("records the parameters it used, so a later change is detectable", async () => {
    const envelope = await seal(await newVaultKey(PASSWORD), SECRET);
    expect(Object.keys(envelope).sort()).toEqual(
      ["ciphertext", "iterations", "iv", "kdf", "salt", "v"].sort(),
    );
    expect(envelope.v).toBe(2);
    expect(envelope.kdf).toBe("PBKDF2-SHA256");
    expect(envelope.iterations).toBeGreaterThanOrEqual(600_000);
  });

  it("opens with any spelling of the password that NFKC folds to the same one", async () => {
    const envelope = await seal(await newVaultKey(UNNORMALISED_PASSWORD), SECRET);
    const folded = UNNORMALISED_PASSWORD.normalize("NFKC");
    expect(folded).not.toBe(UNNORMALISED_PASSWORD);
    expect(await open(await vaultKeyFor(envelope, folded), envelope)).toBe(SECRET);
    expect(await open(await vaultKeyFor(envelope, UNNORMALISED_PASSWORD), envelope)).toBe(SECRET);
  });
});

describe("decryptVault, the previous format", () => {
  const vault = (JSON.parse(V8_WALLET_JSON) as { vault: unknown }).vault;

  it("opens a real stored vault with its password and nothing else", async () => {
    if (!isEncryptedVault(vault)) throw new Error("fixture is not a v8 vault");
    expect(await decryptVault(vault, FIXTURE_PASSWORD)).toEqual(FIXTURE_PHRASE);
    expect(await decryptVault(vault, "not-the-password")).toBeNull();
  });

  it("opens a vault whose password was never normalised, from the password as typed", async () => {
    const typed: unknown = JSON.parse(UNNORMALISED_VAULT_JSON);
    if (!isEncryptedVault(typed)) throw new Error("fixture is not a v8 vault");
    expect(await decryptVault(typed, UNNORMALISED_PASSWORD)).toEqual(FIXTURE_PHRASE);
    // The folded spelling was never the key for this one.
    expect(await decryptVault(typed, UNNORMALISED_PASSWORD.normalize("NFKC"))).toBeNull();
  });
});

describe("isEnvelope / isEncryptedVault", () => {
  it("tell the two formats apart and reject anything else", async () => {
    const envelope = await seal(await newVaultKey(PASSWORD), SECRET);
    const vault = (JSON.parse(V8_WALLET_JSON) as { vault: unknown }).vault;
    expect(isEnvelope(envelope)).toBe(true);
    expect(isEncryptedVault(envelope)).toBe(false);
    expect(isEncryptedVault(vault)).toBe(true);
    expect(isEnvelope(vault)).toBe(false);
    for (const other of [null, {}, ["legal", "winner"], { phrase: FIXTURE_PHRASE }]) {
      expect(isEnvelope(other)).toBe(false);
      expect(isEncryptedVault(other)).toBe(false);
    }
  });
});
