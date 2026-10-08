import type { Keypair } from "@solana/web3.js";
import type { Session } from "../application/ports.js";
import {
  deriveKeypair,
  deriveProfileKeys,
  deriveRewardsKey,
  FUNDING_DERIVATION_INDEX,
} from "../infrastructure/solana/keys.js";
import { getPhrase, getSnapshot, sessionGeneration, unlockedSince } from "./store.js";

/**
 * The current wallet plus its signers, or why nothing can be signed. Every
 * signing path starts here, because the wallet object never carries the
 * phrase: it only exists in memory while unlocked.
 *
 * A session does not outlive the unlock it was taken under. An action can
 * spend a long time on the network between taking a session and signing, and
 * in that time the wallet can be locked by hand, by the idle window, by a
 * reset or from another tab. Each accessor therefore asks the store again at
 * the moment it is called and hands out nothing once that has happened. A key
 * already handed out is covered by `live`: every signing function takes it
 * and asks it again immediately before the key touches a transaction.
 */
export function unlockedSession(): Session<Keypair> | { refused: "walletLocked" } {
  // Asked for first: this is where a wallet left idle past its window locks.
  const phrase = getPhrase();
  const wallet = getSnapshot();
  if (!phrase || !wallet) return { refused: "walletLocked" };
  const since = sessionGeneration();
  const mnemonic = phrase.join(" ");
  const live = () => unlockedSince(since);

  /**
   * Derives a signing key and proves it is the key for the address on
   * screen, so a signature can never spend from an address the user is not
   * looking at.
   */
  const signerFor = (index: number, expectedAddress: string) => {
    if (!live()) return null;
    const keypair = deriveKeypair(mnemonic, index, wallet.derivationScheme);
    return keypair.publicKey.toBase58() === expectedAddress ? keypair : null;
  };

  return {
    wallet,
    live,
    keyAt: (index) => (live() ? deriveKeypair(mnemonic, index, wallet.derivationScheme) : null),
    fundingSigner: () => signerFor(FUNDING_DERIVATION_INDEX, wallet.funding.address),
    portfolioSigner: (portfolio) => signerFor(portfolio.derivationIndex, portfolio.address),
    profileKeys: () => (live() ? deriveProfileKeys(mnemonic) : null),
    rewardsKey: () => (live() ? deriveRewardsKey(mnemonic) : null),
    refusal: () => (live() ? "keyMismatch" : "walletLocked"),
  };
}
