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

/**
 * Accepts a pasted recovery phrase: normalizes whitespace/casing, requires
 * exactly 12 or 24 words, and checks the BIP-39 checksum. Rejects anything
 * else with a plain, user-facing reason rather than silently deriving keys
 * from garbage input.
 */
export function parseRecoveryPhrase(input: string): { words: string[] } | { error: string } {
  const words = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 12 && words.length !== 24) {
    return { error: "A recovery phrase is 12 or 24 words." };
  }
  if (!validateMnemonic(words.join(" "), wordlist)) {
    return {
      error: "Those words don't form a valid recovery phrase. Check the spelling and order.",
    };
  }
  return { words };
}
