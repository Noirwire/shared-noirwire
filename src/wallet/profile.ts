import type { Keypair } from "@solana/web3.js";
import {
  profileSyncBoard,
  profileSyncer,
  type ProfileSyncStatus,
} from "../application/actions/syncProfile.js";
import { profileCipher } from "../infrastructure/profileCipher.js";
import { profileMirror } from "../infrastructure/solana/profile.js";
import { createPortfolio } from "./create.js";
import { store, track } from "./money.js";
import { unlockedSession } from "./session.js";
import { isUnlocked, sessionGeneration, subscribe } from "./store.js";

const board = profileSyncBoard();

/** The unlock the status was last set under. It says nothing about any other. */
let setUnder = -1;

const sync = profileSyncer<Keypair>({
  session: unlockedSession,
  store,
  track,
  mirror: profileMirror,
  cipher: profileCipher,
  newPortfolio: createPortfolio,
  status: {
    get: profileSyncStatus,
    set(next) {
      // The first word of a new unlock: whatever the last one left is dropped first.
      if (sessionGeneration() !== setUnder) board.reset();
      setUnder = sessionGeneration();
      board.set(next);
    },
  },
});

/**
 * Brings the wallet's labels (what each portfolio is called, its mark, its
 * pie, whether it is archived, and the watchlist) and their encrypted
 * mirror into agreement, so the same recovery phrase shows the same labels
 * on another device. An app calls it after an unlock and after any of those
 * labels changes, and does not wait for it.
 *
 * It never rejects: while the server has no mirrors, the wallet is locked
 * or anything fails, the wallet stays as it is. Called while one is under
 * way, it runs once more after it. How it stands is `profileSyncStatus`.
 */
export function syncProfile(): Promise<void> {
  return sync();
}

/**
 * How the wallet's labels stand with their mirror, or null while no sync of
 * this unlock has said: after a reload, and again after every lock. Kept in
 * memory only. The same object until it changes, for a renderer to compare.
 */
export function profileSyncStatus(): ProfileSyncStatus | null {
  return isUnlocked() && sessionGeneration() === setUnder ? board.get() : null;
}

/**
 * Hears of every change to `profileSyncStatus`, a lock that takes it away
 * included, and of nothing else. Hands back what stops it.
 */
export function subscribeProfileSync(listener: () => void): () => void {
  let seen = profileSyncStatus();
  const changed = () => {
    const now = profileSyncStatus();
    if (now === seen) return;
    seen = now;
    listener();
  };
  const stops = [board.subscribe(changed), subscribe(changed)];
  return () => stops.forEach((stop) => stop());
}
