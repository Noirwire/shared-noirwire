import type { PendingActionsDeps } from "./pendingActions.js";

/** The reservations this process is running, by id. One registry for the whole process. */
const held = new Set<string>();

const locks: PendingActionsDeps["locks"] = {
  async hold(id) {
    held.add(id);
    return () => void held.delete(id);
  },
  ownerGone: async (id) => !held.has(id),
};

/**
 * The locks that say a reservation's owner is alive, for an app that runs as
 * one process, such as the phone's. Every caller gets the same registry, so
 * a reservation this process holds, including the one being made right now,
 * is alive to all of them for as long as it is held. Any other was left by an
 * earlier run of the app, which is provably gone, and if nothing was signed
 * under it, it can be released.
 */
export function processLocks(): PendingActionsDeps["locks"] {
  return locks;
}
