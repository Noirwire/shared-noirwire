import { createPendingActions, FUNDING } from "../../../src/application/pendingActions.js";
import { settle } from "../../../src/infrastructure/solana/pending.js";
import { recordSignedWith } from "../../../src/infrastructure/solana/signerAccounts.js";
import { catalog } from "../../../src/wallet/market.js";
import {
  getSnapshot,
  serialised,
  subscribe,
  syncFromStorage,
  updateWallet,
} from "../../../src/wallet/store.js";

/**
 * Pending actions wired the way an app wires them: kept in the wallet store,
 * settled against the chain, and each reservation held alive by a lock in its
 * own name. `held` is the device's set of those locks, shared by every tab;
 * a tab that is closed or reloaded no longer holds the ones it took.
 */
export function wirePending(held: Set<string>) {
  const pending = createPendingActions({
    store: {
      snapshot: getSnapshot,
      update: updateWallet,
      sync: syncFromStorage,
      serialised,
      subscribe,
    },
    locks: {
      async hold(id) {
        held.add(id);
        return () => void held.delete(id);
      },
      async ownerGone(id) {
        return !held.has(id);
      },
    },
    settle,
    prices: catalog,
  });
  recordSignedWith((record) =>
    pending.recordSigned({ ...record, signer: record.signer.toBase58() }),
  );
  return { ...pending, FUNDING };
}
