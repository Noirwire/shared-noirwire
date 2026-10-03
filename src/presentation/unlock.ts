import type { AppPlatform } from "../domain/appPlatform.js";
import { mobileWalletCopy, walletCopy } from "../copy/wallet.js";

/**
 * What a person is told when the wallet could not be opened. The store
 * answers in the web's words; the phone shows its own where those name a
 * browser. Anything else is shown as the store said it.
 */
export function unlockProblemText(problem: string, platform: AppPlatform = "web"): string {
  if (platform !== "mobile") return problem;
  if (problem === walletCopy.store.damaged) return mobileWalletCopy.store.damaged;
  if (problem === walletCopy.store.noWallet) return mobileWalletCopy.store.noWallet;
  return problem;
}

/** Whether the problem is the wrong password, shown under the field and not as a notice. */
export function isWrongPassword(problem: string): boolean {
  return problem === walletCopy.store.wrongPassword;
}
