import type { Keypair } from "@solana/web3.js";
import type { Session } from "../application/ports.js";
import {
  FUNDING_DERIVATION_INDEX,
  keypairFromRoot,
  profileKeysFromRoot,
  rewardsKeyFromRoot,
} from "../infrastructure/solana/keys.js";
import { getKeyRoot, getSnapshot, sessionGeneration, unlockedSince } from "./store.js";

/**
 * The current wallet plus its signers, or why nothing can be signed. Every
 * signing path starts here, because the wallet object never carries key
 * material: it only exists in memory while unlocked.
 *
 * A session does not outlive the unlock it was taken under. An action can
 * spend a long time on the network between taking a session and signing, and
 * in that time the wallet can be locked by hand, by the idle window, by a
 * reset or from another tab. Each accessor therefore asks the store again at
 * the moment it is called and hands out nothing once that has happened. A key
 * already handed out is covered by `live`: every signing function takes it
 * and asks it again immediately before the key touches a transaction.
 *
 * The bytes keys are derived from are asked for again at each derivation,
 * never kept here, since the store zeroes them when it locks.
 */
export function unlockedSession(): Session<Keypair> | { refused: "walletLocked" } {
  // Asked for first: this is where a wallet left idle past its window locks.
  if (!getKeyRoot()) return { refused: "walletLocked" };
  const wallet = getSnapshot();
  if (!wallet) return { refused: "walletLocked" };
  const since = sessionGeneration();
  const live = () => unlockedSince(since);

  /** Runs `derive` over the key root while this session is still the live one. */
  const fromRoot = <T>(derive: (root: Uint8Array) => T): T | null => {
    const root = live() ? getKeyRoot() : null;
    return root ? derive(root) : null;
  };
  const keyAt = (index: number) =>
    fromRoot((root) => keypairFromRoot(root, index, wallet.derivationScheme));

  /**
   * Derives a signing key and proves it is the key for the address on
   * screen, so a signature can never spend from an address the user is not
   * looking at.
   */
  const signerFor = (index: number, expectedAddress: string) => {
    const keypair = keyAt(index);
    return keypair?.publicKey.toBase58() === expectedAddress ? keypair : null;
  };

  return {
    wallet,
    live,
    keyAt,
    fundingSigner: () => signerFor(FUNDING_DERIVATION_INDEX, wallet.funding.address),
    portfolioSigner: (portfolio) => signerFor(portfolio.derivationIndex, portfolio.address),
    profileKeys: () => fromRoot(profileKeysFromRoot),
    rewardsKey: () => fromRoot(rewardsKeyFromRoot),
    refusal: () => (live() ? "keyMismatch" : "walletLocked"),
  };
}
