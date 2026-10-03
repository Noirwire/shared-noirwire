import { FUNDING } from "../../../src/application/pendingActions.js";
import { installMoney } from "../../../src/wallet/money.js";

/**
 * Pending actions wired the way an app wires them, through the one money
 * wiring: kept in the wallet store, settled against the chain, signing
 * guarded, and each reservation held alive by a lock in its own name. `held`
 * is the device's set of those locks, shared by every tab; a tab that is
 * closed or reloaded no longer holds the ones it took.
 */
export function wirePending(held: Set<string>) {
  const { pending } = installMoney({
    async hold(id) {
      held.add(id);
      return () => void held.delete(id);
    },
    async ownerGone(id) {
      return !held.has(id);
    },
  });
  return { ...pending, FUNDING };
}
