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

export type UnlockProblemView = {
  text: string;
  /** Shown under the password field; otherwise as a notice. */
  underField: boolean;
  /**
   * What happens to the password already typed. It is never cleared: after a
   * wrong password it is kept and selected, so one keystroke replaces it and
   * a slip can be corrected without typing it all again.
   */
  typed: "keepSelected" | "keep";
};

/** A failed unlock, as the screen shows it. */
export function unlockProblemView(
  problem: string,
  platform: AppPlatform = "web",
): UnlockProblemView {
  const wrong = isWrongPassword(problem);
  return {
    text: unlockProblemText(problem, platform),
    underField: wrong,
    typed: wrong ? "keepSelected" : "keep",
  };
}
