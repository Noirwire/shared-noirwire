import { describe, expect, it } from "vitest";
import { generateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { derivePath } from "ed25519-hd-key";
import {
  APP_DERIVATION_PATH,
  FUNDING_DERIVATION_INDEX,
  WALLET_DEFAULT_DERIVATION_PATH,
  deriveCandidateKeypairs,
  deriveKeypair,
  generateWalletMnemonic,
  parseRecoveryPhrase,
  phraseWords,
} from "../../src/infrastructure/solana/keys.js";

/**
 * The most widely published BIP-39 test vector (12x "abandon" ending in
 * "about", entropy all-zero, passphrase "TREZOR"). Used below to prove the
 * mnemonic-to-seed step matches the spec, independent of this codebase.
 */
const BIP39_TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const BIP39_TEST_SEED_HEX =
  "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04";

/**
 * Official SLIP-0010 ed25519 test vector 1: seed 000102030405060708090a0b0c0d0e0f,
 * node m/0'. Used to prove the SLIP-0010 HD derivation step matches the spec,
 * independent of this codebase. (https://github.com/satoshilabs/slips/blob/master/slip-0010.md)
 */
const SLIP10_TEST_SEED_HEX = "000102030405060708090a0b0c0d0e0f";
const SLIP10_M0H_PRIVATE_KEY_HEX =
  "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3";
const SLIP10_M0H_CHAIN_CODE_HEX =
  "8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69";

describe("known test vectors (independent of this app's own code)", () => {
  it("mnemonicToSeedSync matches the canonical BIP-39 test vector", () => {
    const seed = mnemonicToSeedSync(BIP39_TEST_MNEMONIC, "TREZOR");
    expect(Buffer.from(seed).toString("hex")).toBe(BIP39_TEST_SEED_HEX);
  });

  it("derivePath matches the canonical SLIP-0010 ed25519 test vector at m/0'", () => {
    const { key, chainCode } = derivePath("m/0'", SLIP10_TEST_SEED_HEX);
    expect(Buffer.from(key).toString("hex")).toBe(SLIP10_M0H_PRIVATE_KEY_HEX);
    expect(Buffer.from(chainCode).toString("hex")).toBe(SLIP10_M0H_CHAIN_CODE_HEX);
  });
});

describe("deriveKeypair", () => {
  const mnemonic = generateWalletMnemonic();

  it("is deterministic: the same (mnemonic, index, scheme) always derives the same keypair", () => {
    const a = deriveKeypair(mnemonic, 0, "app");
    const b = deriveKeypair(mnemonic, 0, "app");
    expect(a.publicKey.toBase58()).toBe(b.publicKey.toBase58());
    expect(a.secretKey).toEqual(b.secretKey);
  });

  it("derives a different keypair for a different index", () => {
    const a = deriveKeypair(mnemonic, 0, "app");
    const b = deriveKeypair(mnemonic, 1, "app");
    expect(a.publicKey.toBase58()).not.toBe(b.publicKey.toBase58());
  });

  it("derives a different address for the same index under a different scheme", () => {
    const app = deriveKeypair(mnemonic, 0, "app");
    const walletDefault = deriveKeypair(mnemonic, 0, "walletDefault");
    expect(app.publicKey.toBase58()).not.toBe(walletDefault.publicKey.toBase58());
  });

  it("defaults to the app scheme when none is given", () => {
    const withDefault = deriveKeypair(mnemonic, 0);
    const explicitApp = deriveKeypair(mnemonic, 0, "app");
    expect(withDefault.publicKey.toBase58()).toBe(explicitApp.publicKey.toBase58());
  });

  it("matches the app derivation path directly derived via ed25519-hd-key", () => {
    const seedHex = Buffer.from(mnemonicToSeedSync(mnemonic)).toString("hex");
    const { key } = derivePath(APP_DERIVATION_PATH(3), seedHex);
    const derived = deriveKeypair(mnemonic, 3, "app");
    expect(derived.secretKey.slice(0, 32)).toEqual(new Uint8Array(key.subarray(0, 32)));
  });

  it("matches the wallet-default derivation path directly derived via ed25519-hd-key", () => {
    const seedHex = Buffer.from(mnemonicToSeedSync(mnemonic)).toString("hex");
    const { key } = derivePath(WALLET_DEFAULT_DERIVATION_PATH(2), seedHex);
    const derived = deriveKeypair(mnemonic, 2, "walletDefault");
    expect(derived.secretKey.slice(0, 32)).toEqual(new Uint8Array(key.subarray(0, 32)));
  });
});

describe("deriveCandidateKeypairs", () => {
  it("returns both schemes' keypairs for the same index, matching deriveKeypair for each", () => {
    const mnemonic = generateWalletMnemonic();
    const candidates = deriveCandidateKeypairs(mnemonic, FUNDING_DERIVATION_INDEX);
    expect(candidates.app.publicKey.toBase58()).toBe(
      deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, "app").publicKey.toBase58(),
    );
    expect(candidates.walletDefault.publicKey.toBase58()).toBe(
      deriveKeypair(mnemonic, FUNDING_DERIVATION_INDEX, "walletDefault").publicKey.toBase58(),
    );
    expect(candidates.app.publicKey.toBase58()).not.toBe(
      candidates.walletDefault.publicKey.toBase58(),
    );
  });
});

describe("parseRecoveryPhrase", () => {
  it("accepts a valid 12-word phrase", () => {
    const result = parseRecoveryPhrase(BIP39_TEST_MNEMONIC);
    expect(result).toEqual({ words: BIP39_TEST_MNEMONIC.split(" ") });
  });

  it("accepts a valid 24-word phrase", () => {
    const valid24 = generateMnemonic(wordlist, 256);
    expect(valid24.split(" ")).toHaveLength(24);
    const result = parseRecoveryPhrase(valid24);
    expect(result).toEqual({ words: valid24.split(" ") });
  });

  it("rejects a phrase with the wrong word count", () => {
    const result = parseRecoveryPhrase("abandon abandon abandon");
    expect(result).toEqual({
      error: "A recovery phrase is 12 or 24 words. This has 3.",
      problem: { kind: "wordCount", count: 3 },
    });
  });

  it("rejects 12 real wordlist words with an invalid checksum", () => {
    const invalid = "abandon ".repeat(11) + "ability";
    const result = parseRecoveryPhrase(invalid);
    expect(result).toEqual({
      error:
        "These are all real words, but together they are not a recovery phrase. Check that every word is the right one and in the right order.",
      problem: { kind: "checksum" },
    });
  });

  it("reads a phrase however it was pasted: numbered, comma separated, on lines, tabbed, in capitals", () => {
    const phrase = generateMnemonic(wordlist);
    const words = phrase.split(" ");
    const pasted = [
      words.map((word, index) => `${index + 1}. ${word}`).join(" "),
      words.map((word, index) => `${index + 1}) ${word}`).join("\n"),
      words.map((word, index) => `${index + 1}.${word}`).join("\r\n"),
      words.join(", "),
      words.join("\t"),
      `  ${phrase.toUpperCase()}  `,
      words.map((word) => word[0].toUpperCase() + word.slice(1)).join(",\n"),
    ];
    for (const text of pasted) expect(parseRecoveryPhrase(text)).toEqual({ words });
    expect(phraseWords("1. Abandon\n2. ability,\tABLE")).toEqual(["abandon", "ability", "able"]);
  });

  it("names the word that is not a recovery phrase word, and where it stands", () => {
    const words = generateMnemonic(wordlist).split(" ");
    words[4] = "abandn";
    expect(parseRecoveryPhrase(words.join(" "))).toEqual({
      error: 'Word 5, "abandn", is not a recovery phrase word. Check its spelling.',
      problem: { kind: "unknownWord", word: "abandn", position: 5 },
    });
  });

  it("says how many words there were when the count is wrong", () => {
    const eleven = generateMnemonic(wordlist).split(" ").slice(0, 11).join(" ");
    expect(parseRecoveryPhrase(eleven)).toMatchObject({
      error: "A recovery phrase is 12 or 24 words. This has 11.",
    });
    expect(parseRecoveryPhrase("")).toMatchObject({ problem: { kind: "wordCount", count: 0 } });
  });

  it("normalizes whitespace and casing", () => {
    const messy = `  ${BIP39_TEST_MNEMONIC.toUpperCase().split(" ").join("   ")}  `;
    const result = parseRecoveryPhrase(messy);
    expect(result).toEqual({ words: BIP39_TEST_MNEMONIC.split(" ") });
  });
});
