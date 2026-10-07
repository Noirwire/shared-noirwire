import {
  MAX_PROFILE_BYTES,
  decodeProfile,
  encodeProfile,
  mayWriteProfile,
  mergeProfile,
  profileFieldsOf,
  withProfileChanges,
  type ProfileEnvelope,
  type ProfileMerge,
} from "../../domain/profile.js";
import type { UsageFields } from "../../domain/usageEvents.js";
import type { Portfolio } from "../../domain/wallet.js";
import type {
  MirroredProfile,
  MirrorWrite,
  OpenSession,
  ProfileCipher,
  ProfileMirror,
  Session,
  Signer,
  Track,
  WalletStore,
} from "../ports.js";
import { refused, type Refused } from "../result.js";
import { othersOf } from "../walletRecord.js";
import { openSession } from "./common.js";
import { portfolioAt } from "./createPortfolio.js";

export type ProfileSyncDeps<K extends Signer> = {
  session: OpenSession<K>;
  store: WalletStore;
  track: Track;
  mirror: ProfileMirror<K>;
  cipher: ProfileCipher;
  /** A new portfolio record for the key at `derivationIndex`, whose address is `address`. */
  newPortfolio(label: string, address: string, derivationIndex: number): Portfolio;
  /** Where each sync says how it stands, for a screen to read. */
  status: Pick<ProfileSyncBoard, "get" | "set">;
};

/**
 * How the wallet's labels stand with their mirror, as far as the last sync
 * of this unlock could tell:
 * - `off`: the server keeps no mirrors, or this version may not write the
 *   one there is. Nothing is shown.
 * - `syncing`: a sync is under way.
 * - `synced`: the last sync left the device and the mirror agreeing. `at`
 *   is when, by this device's clock, and is only ever shown.
 * - `behind`: the last sync failed with mirrors known to be kept. The labels
 *   are safe on this device and not mirrored yet.
 */
export type ProfileSyncStatus =
  { kind: "off" } | { kind: "syncing" } | { kind: "synced"; at: number } | { kind: "behind" };

/** The status, kept in memory and nowhere else. Null until a sync has said anything. */
export type ProfileSyncBoard = {
  get(): ProfileSyncStatus | null;
  set(next: ProfileSyncStatus): void;
  /** Back to null: what was said of one unlock says nothing of the next. */
  reset(): void;
  /** Hears of every change, and of nothing else. Hands back what stops it. */
  subscribe(listener: () => void): () => void;
};

const sameStatus = (a: ProfileSyncStatus | null, b: ProfileSyncStatus) =>
  a?.kind === b.kind && (a.kind !== "synced" || b.kind !== "synced" || a.at === b.at);

export function profileSyncBoard(): ProfileSyncBoard {
  let status: ProfileSyncStatus | null = null;
  const listeners = new Set<() => void>();
  const becomes = (next: ProfileSyncStatus | null) => {
    status = next;
    listeners.forEach((listener) => listener());
  };
  return {
    get: () => status,
    set(next) {
      if (!sameStatus(status, next)) becomes(next);
    },
    reset() {
      if (status !== null) becomes(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** Where a sync that failed stopped. */
export type ProfileSyncStage = UsageFields["stage"];

export type ProfileSyncResult =
  /** The server says it keeps no mirrors. Nothing was read or written, and nothing is counted. */
  | { kind: "off" }
  /** The device and the mirror agree. `wrote` when the mirror had to be written for that. */
  | { kind: "synced"; wrote: boolean }
  /** Stopped, with the wallet as it was. */
  | { kind: "failed"; stage: ProfileSyncStage }
  | Refused;

/** How many times a sync reads, merges and writes before it gives up on a mirror that keeps moving. */
export const PROFILE_SYNC_TRIES = 3;

/**
 * Brings the wallet's labels and their mirror into agreement: read the
 * mirror, open it, merge it with the device's labels, write the mirror when
 * it has to change, and only then take the mirror's labels into the wallet
 * and keep the merged copy as the last synced one.
 *
 * The wallet is changed last, and in one write, so that a sync that stops
 * anywhere leaves it exactly as it was: the next one starts from the same
 * place. A mirror that moved between the read and the write is read again,
 * `PROFILE_SYNC_TRIES` times in all. A mirror that cannot be opened, an
 * older record put back under a newer revision included, is neither
 * followed nor written over. A wallet write the store says did not reach
 * storage ends the sync as failed, so nothing is counted as synced that a
 * restart would not find.
 *
 * One sync at a time, across tabs. No money action waits on it or reads
 * from it, it reserves nothing, and nothing it finds is told to anyone: a
 * failure is counted and that is all.
 */
export async function syncProfile<K extends Signer>(
  deps: ProfileSyncDeps<K>,
): Promise<ProfileSyncResult> {
  return deps.store.serialised("noirwire-profile-sync", async () => {
    const session = openSession(deps.session);
    if ("kind" in session) return session;
    const stopped = (stage: ProfileSyncStage): ProfileSyncResult => {
      if (!session.live()) return refused("walletLocked");
      deps.track("profile_sync_failed", { stage });
      // Mirrors are known to be kept once a sync of this unlock got past asking.
      const known = deps.status.get();
      deps.status.set({ kind: known && known.kind !== "off" ? "behind" : "off" });
      return { kind: "failed", stage };
    };

    // A server that says it keeps no mirrors is an answer, and nothing is
    // counted. One that could not be asked is a failure like any other.
    let limits: { maxDataLen: number } | null;
    try {
      limits = await deps.mirror.limits();
    } catch {
      return stopped("config");
    }
    if (!limits) {
      deps.status.set({ kind: "off" });
      return { kind: "off" };
    }
    deps.status.set({ kind: "syncing" });
    const keys = session.profileKeys();
    if (!keys) return refused("walletLocked");
    const owner = keys.owner.publicKey.toBase58();

    for (let tried = 0; tried < PROFILE_SYNC_TRIES; tried += 1) {
      let stored: MirroredProfile | null;
      try {
        stored = await deps.mirror.read(keys.owner, session.live);
      } catch {
        return stopped("read");
      }
      const wallet = deps.store.snapshot();
      if (!wallet || !session.live()) return refused("walletLocked");

      let mirror: ProfileEnvelope | null = null;
      if (stored) {
        const opened =
          stored.data.length > MAX_PROFILE_BYTES
            ? null
            : await deps.cipher.open(
                keys.secret,
                { owner, revision: stored.revision },
                stored.data,
              );
        mirror = opened === null ? null : decodeProfile(opened);
        if (!mirror) return stopped("unreadable");
      }

      const merged = mergeProfile({
        device: profileFieldsOf(wallet),
        synced: wallet.syncedProfile ? decodeProfile(wallet.syncedProfile) : null,
        mirror,
      });

      let outcome: MirrorWrite | null = null;
      if (merged.write) {
        try {
          // Sealed for the revision the mirror will have once this is in it.
          const revision = stored ? stored.revision + 1n : 1n;
          const data = await deps.cipher.seal(
            keys.secret,
            { owner, revision },
            encodeProfile(merged.envelope),
          );
          if (data.length > limits.maxDataLen) return stopped("too_large");
          const sending = {
            keepOut: othersOf(wallet, { address: owner }),
            stillUnlocked: session.live,
          };
          outcome = stored
            ? await deps.mirror.write(keys.owner, stored.revision, data, sending)
            : await deps.mirror.create(keys.owner, data, sending);
        } catch {
          return stopped("write");
        }
      }
      if (outcome === "stale") continue;

      const kept = await keep(deps, session, merged);
      if (kept === "notSaved") return stopped("save");
      if (outcome === "written" || kept === "saved") deps.track("profile_synced");
      // A mirror this version may not write was read and no more: nothing to show for it.
      deps.status.set(
        mayWriteProfile(mirror) ? { kind: "synced", at: Date.now() } : { kind: "off" },
      );
      return { kind: "synced", wrote: outcome === "written" };
    }
    return stopped("conflict");
  });
}

/**
 * Takes what the mirror had for the device into the wallet, and keeps
 * `merged` as the last synced copy, in one write. A wallet that already
 * holds both is not written at all.
 */
async function keep<K extends Signer>(
  deps: ProfileSyncDeps<K>,
  session: Session<K>,
  merged: ProfileMerge,
): Promise<"saved" | "unchanged" | "notSaved"> {
  const syncedProfile = encodeProfile(merged.envelope);
  const unchanged =
    merged.changes.length === 0 && deps.store.snapshot()?.syncedProfile === syncedProfile;
  if (unchanged) return "unchanged";
  const saved = await deps.store.update((current) => ({
    ...withProfileChanges(current, merged.changes, (index, label) =>
      portfolioAt(deps, session, index, label),
    ),
    syncedProfile,
  }));
  return saved ? "saved" : "notSaved";
}

/**
 * `syncProfile` for an app to call after an unlock and after a label
 * changes: never two at once, and never a rejection. Asked for while one is
 * under way, it runs once more when that one ends, so a label changed in
 * the meantime is not left behind.
 */
export function profileSyncer<K extends Signer>(deps: ProfileSyncDeps<K>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await syncProfile(deps).catch(() => undefined);
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  };
}
