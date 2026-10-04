import { appCopy } from "../copy/app.js";

export type UnreachableView = {
  message: string;
  retry: string;
  /**
   * Whether the unlock screen is still shown, with this as a notice on it.
   * Unlocking reads only what the device stores, so a stored wallet opens
   * with NoirWire out of reach; what needs the chain stays held back after.
   */
  unlockOffered: boolean;
};

/**
 * What the app says when NoirWire could not be reached as it opens. Someone
 * with no wallet, or with one still locked, has no balances on screen to
 * speak of, so they are told about the connection and nothing about money.
 */
export function unreachableView(state: { hasWallet: boolean; locked: boolean }): UnreachableView {
  const gate = appCopy.networkGate;
  const unlocked = state.hasWallet && !state.locked;
  return {
    message: unlocked ? gate.unreachable : gate.cannotReach,
    retry: gate.retry,
    unlockOffered: state.hasWallet && state.locked,
  };
}
