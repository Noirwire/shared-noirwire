import "./buffer-polyfill.js";

import { Buffer } from "buffer";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { CKDPriv, getMasterKeyFromSeed, isValidPath } from "ed25519-hd-key";
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
 * The 64 bytes every key of a wallet is derived from: SLIP-0010's ed25519
 * master node for the phrase's BIP-39 seed, its 32-byte key followed by its
 * 32-byte chain code. An unlocked wallet holds this and not the phrase, so
 * each key is derived over bytes that can be zeroed when the wallet locks.
 *
 * The derivation library takes the BIP-39 seed only as a hex string, so one
 * is made here, once, for the master node. The seed's bytes are zeroed as
 * soon as it is made; the string cannot be, and is left to the collector.
 */
export function keyRootOf(mnemonic: string): Uint8Array {
  const derived = mnemonicToSeedSync(mnemonic);
  const seed = Buffer.from(derived);
  derived.fill(0);
  try {
    const { key, chainCode } = getMasterKeyFromSeed(seed.toString("hex"));
    const root = new Uint8Array(ROOT_LENGTH);
    root.set(key);
    root.set(chainCode, KEY_LENGTH);
    key.fill(0);
    chainCode.fill(0);
    return root;
  } finally {
    seed.fill(0);
  }
}

const KEY_LENGTH = 32;
const ROOT_LENGTH = 64;
const HARDENED_OFFSET = 0x80000000;

/**
 * The 32 key bytes SLIP-0010 derives from `root` at `path`, every level
 * hardened. Each node passed on the way is zeroed once the next is made.
 */
function keyAt(root: Uint8Array, path: string): Uint8Array {
  if (root.length !== ROOT_LENGTH || !isValidPath(path)) {
    throw new Error("Invalid derivation path");
  }
  let node: { key: Uint8Array; chainCode: Uint8Array } = {
    key: root.slice(0, KEY_LENGTH),
    chainCode: root.slice(KEY_LENGTH),
  };
  for (const segment of path.split("/").slice(1)) {
    const next = CKDPriv(node, Number.parseInt(segment.replace("'", ""), 10) + HARDENED_OFFSET);
    node.key.fill(0);
    node.chainCode.fill(0);
    node = next;
  }
  node.chainCode.fill(0);
  return node.key;
}

/** The keypair for the key at `path`. Its bytes are copied into the keypair and zeroed here. */
function keypairAt(root: Uint8Array, path: string): Keypair {
  const key = keyAt(root, path);
  try {
    return Keypair.fromSeed(key);
  } finally {
    key.fill(0);
  }
}

/** Runs `use` over the root of `mnemonic`, and zeroes the root after it. */
function withRoot<T>(mnemonic: string, use: (root: Uint8Array) => T): T {
  const root = keyRootOf(mnemonic);
  try {
    return use(root);
  } finally {
    root.fill(0);
  }
}

/**
 * Derives the Solana keypair for one account of a wallet, from its root (see
 * `keyRootOf`), under the given derivation scheme (this app's own path by
 * default). Every keypair is re-derived on demand; none is ever persisted on
 * its own. A wallet's scheme is fixed at creation/import time
 * (`Wallet.derivationScheme`) and every call for that wallet must pass it,
 * so every account keeps landing on the same addresses.
 */
export function keypairFromRoot(
  root: Uint8Array,
  index: number,
  scheme: DerivationScheme = "app",
): Keypair {
  return keypairAt(root, pathFor(scheme, index));
}

/** `keypairFromRoot` for a mnemonic in hand, as creating or importing a wallet has. */
export function deriveKeypair(
  mnemonic: string,
  index: number,
  scheme: DerivationScheme = "app",
): Keypair {
  return withRoot(mnemonic, (root) => keypairFromRoot(root, index, scheme));
}

/**
 * Where the keys of a wallet's profile sit: under a purpose of their own,
 * not the `44'` every account of either scheme is under, so no funding
 * wallet and no portfolio can ever be derived onto them.
 */
export const PROFILE_OWNER_PATH = "m/20055'/0'/0'";
export const PROFILE_SECRET_PATH = "m/20055'/1'/0'";

/**
 * The keys of a wallet's profile, the encrypted copy of its labels kept off
 * the device: the key that owns the record, and the secret its contents are
 * sealed with. The same for a phrase whichever scheme its accounts use, and
 * re-derived on demand like every other key.
 */
export function profileKeysFromRoot(root: Uint8Array): { owner: Keypair; secret: Uint8Array } {
  return {
    owner: keypairAt(root, PROFILE_OWNER_PATH),
    secret: keyAt(root, PROFILE_SECRET_PATH),
  };
}

/** `profileKeysFromRoot` for a mnemonic in hand. */
export function deriveProfileKeys(mnemonic: string): { owner: Keypair; secret: Uint8Array } {
  return withRoot(mnemonic, profileKeysFromRoot);
}

/**
 * Where a wallet's rewards key sits: under a purpose of its own again, so
 * it is no account of either scheme and no key of the profile.
 */
export const REWARDS_KEY_PATH = "m/20056'/0'/0'";

/**
 * The key a wallet is known to rewards by. It is not a Solana account and
 * holds nothing: its public key names the member, and it signs what the
 * member asks of the server. The same for a phrase whichever scheme its
 * accounts use, and re-derived on demand like every other key.
 */
export function rewardsKeyFromRoot(root: Uint8Array): Keypair {
  return keypairAt(root, REWARDS_KEY_PATH);
}

/** `rewardsKeyFromRoot` for a mnemonic in hand. */
export function deriveRewardsKey(mnemonic: string): Keypair {
  return withRoot(mnemonic, rewardsKeyFromRoot);
}

/** Both candidate keypairs for one index, one per known derivation scheme. Used only to resolve an import. */
export function deriveCandidateKeypairs(
  mnemonic: string,
  index: number,
): Record<DerivationScheme, Keypair> {
  return withRoot(mnemonic, (root) => ({
    app: keypairFromRoot(root, index, "app"),
    walletDefault: keypairFromRoot(root, index, "walletDefault"),
  }));
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
