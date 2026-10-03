import { describe, expect, it } from "vitest";
import { mobileWalletCopy, walletCopy } from "../../../src/copy/wallet.js";
import { isWrongPassword, unlockProblemText } from "../../../src/presentation/unlock.js";

describe("unlockProblemText", () => {
  it("is the store's own words on the web", () => {
    for (const problem of Object.values(walletCopy.store)) {
      expect(unlockProblemText(problem)).toBe(problem);
      expect(unlockProblemText(problem, "web")).toBe(problem);
    }
  });

  it("is the phone's words where the store names a browser", () => {
    expect(unlockProblemText(walletCopy.store.damaged, "mobile")).toBe(
      "The wallet stored on this phone cannot be read. Reset it and import it again from your recovery phrase.",
    );
    expect(unlockProblemText(walletCopy.store.noWallet, "mobile")).toBe(
      "There is no wallet on this phone.",
    );
    expect(mobileWalletCopy.store.noWallet).toBe("There is no wallet on this phone.");
  });

  it("passes anything else on as the store said it", () => {
    expect(unlockProblemText(walletCopy.store.interrupted, "mobile")).toBe(
      walletCopy.store.interrupted,
    );
    expect(unlockProblemText("something new", "mobile")).toBe("something new");
  });
});

describe("isWrongPassword", () => {
  it("is true only for the wrong-password answer", () => {
    expect(isWrongPassword(walletCopy.store.wrongPassword)).toBe(true);
    expect(isWrongPassword(walletCopy.store.damaged)).toBe(false);
  });
});
