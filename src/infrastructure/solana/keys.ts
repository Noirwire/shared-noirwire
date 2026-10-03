import "./buffer-polyfill.js";

import { Buffer } from "buffer";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";
import type { DerivationScheme } from "../../domain/wallet.js";

/**
 * `@scure/bip39` (Paul Miller's audited `@noble`/`@scure` suite - the same
 * primitives MetaMask, ethers.js and viem run on) is used here in place of
 * the plain `bip39` package: same algorithm, an audited implementation.
 */

/** The wallet's main/funding account always sits at derivation index 0. */
export const FUNDING_DERIVATION_INDEX = 0;

/** This app's own path: hardened SLIP-0010 with a trailing hardened "change" level. */
export const APP_DERIVATION_PATH = (index: number) => `m/44'/501'/${index}'/0'`;

/**
 * The path several other Solana wallets (Phantom, Solflare among them) use
 * for their default account: the same hardened path, without the trailing
 * change level.
 */
export const WALLET_DEFAULT_DERIVATION_PATH = (index: number) => `m/44'/501'/${index}'`;

function pathFor(scheme: DerivationScheme, index: number): string {
  return scheme === "app" ? APP_DERIVATION_PATH(index) : WALLET_DEFAULT_DERIVATION_PATH(index);
}

/** A fresh 12-word BIP-39 mnemonic for a new wallet. */
export function generateWalletMnemonic(): string {
  return generateMnemonic(wordlist);
}

/**
 * Derives the Solana keypair for one account of a wallet's mnemonic, under
 * the given derivation scheme (this app's own path by default). Every
 * keypair is re-derived on demand; none is ever persisted on its own. A
 * wallet's scheme is fixed at creation/import time (`Wallet.derivationScheme`)
 * and every call for that wallet must pass it, so every account keeps
 * landing on the same addresses.
 */
export function deriveKeypair(
  mnemonic: string,
  index: number,
  scheme: DerivationScheme = "app",
): Keypair {
  const seed = mnemonicToSeedSync(mnemonic);
  const seedHex = Buffer.from(seed).toString("hex");
  const { key } = derivePath(pathFor(scheme, index), seedHex);
  return Keypair.fromSeed(key.subarray(0, 32));
}

/** Both candidate keypairs for one index, one per known derivation scheme. Used only to resolve an import. */
export function deriveCandidateKeypairs(
  mnemonic: string,
  index: number,
): Record<DerivationScheme, Keypair> {
  return {
    app: deriveKeypair(mnemonic, index, "app"),
    walletDefault: deriveKeypair(mnemonic, index, "walletDefault"),
  };
}

/** What is wrong with a pasted recovery phrase, precisely enough to fix it. */
export type PhraseProblem =
  /** Not 12 or 24 words. `count` is how many there were. */
  | { kind: "wordCount"; count: number }
  /** A word that is not in the list a phrase is made from, and where it stands, from 1. */
  | { kind: "unknownWord"; word: string; position: number }
  /** Every word is a real one, and together they are not a phrase: one is wrong, missing or out of place. */
  | { kind: "checksum" };

const WORDS = new Set(wordlist);

/**
 * The words of a phrase as people really paste one: from a numbered list
 * ("1. word 2. word"), with commas, line breaks or tabs between them, in
 * capitals. A recovery phrase word is made of letters only, so everything
 * else, the numbering included, only separates words.
 */
export function phraseWords(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

function phraseProblemText(problem: PhraseProblem): string {
  switch (problem.kind) {
    case "wordCount":
      return `A recovery phrase is 12 or 24 words. This has ${problem.count}.`;
    case "unknownWord":
      return `Word ${problem.position}, "${problem.word}", is not a recovery phrase word. Check its spelling.`;
    case "checksum":
      return "These are all real words, but together they are not a recovery phrase. Check that every word is the right one and in the right order.";
  }
}

/**
 * Accepts a pasted recovery phrase: reads its words however they were laid
 * out (`phraseWords`), requires exactly 12 or 24 of them, each from the
 * BIP-39 list, and checks the checksum. Anything else is refused with what
 * exactly is wrong, in `error` as words and in `problem` as data, rather
 * than silently deriving keys from garbage input.
 */
export function parseRecoveryPhrase(
  input: string,
): { words: string[] } | { error: string; problem: PhraseProblem } {
  const words = phraseWords(input);
  const refuse = (problem: PhraseProblem) => ({ error: phraseProblemText(problem), problem });
  if (words.length !== 12 && words.length !== 24) {
    return refuse({ kind: "wordCount", count: words.length });
  }
  const unknown = words.findIndex((word) => !WORDS.has(word));
  if (unknown >= 0) {
    return refuse({ kind: "unknownWord", word: words[unknown], position: unknown + 1 });
  }
  if (!validateMnemonic(words.join(" "), wordlist)) return refuse({ kind: "checksum" });
  return { words };
}
