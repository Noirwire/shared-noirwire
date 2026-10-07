import type { Keypair } from "@solana/web3.js";
import { profileSyncer } from "../application/actions/syncProfile.js";
import { profileCipher } from "../infrastructure/profileCipher.js";
import { profileMirror } from "../infrastructure/solana/profile.js";
import { createPortfolio } from "./create.js";
import { store, track } from "./money.js";
import { unlockedSession } from "./session.js";

const sync = profileSyncer<Keypair>({
  session: unlockedSession,
  store,
  track,
  mirror: profileMirror,
  cipher: profileCipher,
  newPortfolio: createPortfolio,
});

/**
 * Brings the wallet's labels (what each portfolio is called, its mark, its
 * pie, whether it is archived, and the watchlist) and their encrypted
 * mirror into agreement, so the same recovery phrase shows the same labels
 * on another device. An app calls it after an unlock and after any of those
 * labels changes, and does not wait for it.
 *
 * It never rejects and has nothing to show: while the server has no
 * mirrors, the wallet is locked or anything fails, the wallet stays as it
 * is. Called while one is under way, it runs once more after it.
 */
export function syncProfile(): Promise<void> {
  return sync();
}
