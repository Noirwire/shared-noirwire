import { describe, expect, it } from "vitest";
import { mobileOnboardingCopy, onboardingCopy } from "../../src/copy/onboarding.js";
import { walletCopy } from "../../src/copy/wallet.js";
import { activityCopy, mobileActivityCopy } from "../../src/copy/activity.js";
import { mobileAppCopy } from "../../src/copy/app.js";
import { earnCopy, mobileEarnCopy } from "../../src/copy/earn.js";
import { errorsCopy, mobileErrorsCopy } from "../../src/copy/errors.js";
import { fundingCopy, mobileFundingCopy } from "../../src/copy/funding.js";
import { marketsCopy, mobileMarketsCopy } from "../../src/copy/markets.js";
import { mobilePendingActionCopy, pendingActionCopy } from "../../src/copy/pendingAction.js";
import { mobilePieCopy, pieCopy } from "../../src/copy/pie.js";
import { mobilePortfolioCopy, portfolioCopy } from "../../src/copy/portfolio.js";
import { mobileSendCopy, sendCopy } from "../../src/copy/send.js";
import { mobileTradeCopy, tradeCopy } from "../../src/copy/trade.js";
import { chainErrorMessage, refusalMessage } from "../../src/presentation/actionResult.js";

const PHONE = [
  mobileOnboardingCopy,
  mobileActivityCopy,
  mobileAppCopy,
  mobileEarnCopy,
  mobileErrorsCopy,
  mobileFundingCopy,
  mobileMarketsCopy,
  mobilePendingActionCopy,
  mobilePieCopy,
  mobilePortfolioCopy,
  mobileSendCopy,
  mobileTradeCopy,
];

/**
 * Every string a copy object holds, its functions called with placeholder
 * words. A function that needs a list rather than words is called with one.
 */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const call = value as (...args: unknown[]) => unknown;
    const words = ["X", "Y", "Z", "W"];
    try {
      return strings(call(...words));
    } catch {
      return strings(call(words));
    }
  }
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/**
 * The web's strings are built from the same templates as the phone's. These
 * pin the web's wording byte for byte, so a template change cannot move it.
 */
describe("per-platform copy", () => {
  it("keeps the web's wording exactly", () => {
    expect(onboardingCopy.welcome.trustMainnet).toBe(
      "Your keys and recovery phrase stay in this browser. Network requests are relayed by NoirWire's server, which stores and logs nothing. Tracker issuers keep control over their own tokens. The risks are set out in Settings.",
    );
    expect(onboardingCopy.welcome.trustTestNetwork).toBe(
      "Your keys and recovery phrase stay in this browser. Network requests are relayed by NoirWire's server, which stores and logs nothing. Keys are real; funds are Solana devnet SOL and a test USDC-alike token.",
    );
    expect(onboardingCopy.phrase.intro).toBe(
      "These words are the only way back into your money if this device is lost. Write them on paper. Anyone who sees them can take everything.",
    );
    expect(walletCopy.store.notSaved).toBe(
      "This browser would not save the wallet (storage is full or blocked). Nothing was changed.",
    );
  });

  it("says the same on the phone with the phone's words", () => {
    expect(mobileOnboardingCopy.welcome.trust).toBe(
      "Your keys and recovery phrase stay on this phone. Network requests are relayed by NoirWire's server, which stores and logs nothing. Tracker issuers keep control over their own tokens.",
    );
    expect(mobileOnboardingCopy.phrase.intro).toBe(
      "These words are the only way back into your money if this phone is lost. Write them on paper. Anyone who sees them can take everything.",
    );
    expect(mobileOnboardingCopy.password.notSaved).toBe(
      "This phone would not save the wallet (storage is full or blocked). Nothing was changed.",
    );
  });

  it("puts a method name at the start of a sentence with a capital", () => {
    expect(mobileOnboardingCopy.biometric.notTurnedOn("fingerprint")).toBe(
      "Fingerprint was not turned on. You can turn it on later in Settings.",
    );
  });

  it("keeps the web's wording exactly where a string became a platform template", () => {
    expect(portfolioCopy.create.lead).toBe(
      "Give it a name only you see. The name never leaves this browser.",
    );
    expect(portfolioCopy.observer.relayed).toBe(
      "These stay in this browser. Balance reads and trades are relayed by NoirWire's server, so the network provider, Jupiter and MagicBlock see this address but never your IP address. The relay stores and logs nothing; you have to trust it not to.",
    );
    expect(pendingActionCopy.notRecorded).toBe(
      "This could not be saved in this browser, so nothing was sent.",
    );
    expect(errorsCopy.portfolioNotSaved).toBe(
      "The new portfolio could not be saved in this browser.",
    );
    expect(fundingCopy.noSolNeeded).toBe(
      "No SOL is needed. If the transfer would take more than this total, it is not signed.",
    );
    expect(fundingCopy.privateCosts(0.1, "0.20 USDC", "USDC", "0.50 USDC")).toContain(
      "your funding wallet needs no SOL",
    );
  });

  it("never says browser on the phone", () => {
    for (const text of strings(PHONE)) expect(text).not.toMatch(/browser/i);
    expect(mobilePortfolioCopy.publicView.relayed).toMatch(/^These stay on this phone\./);
    expect(mobileActivityCopy.emptyDetail).toBe(
      "History is kept on this phone only. A wallet restored on a new phone starts with an empty list.",
    );
    expect(chainErrorMessage("notRecorded", "mobile")).toBe(
      "This could not be saved on this phone, so nothing was sent.",
    );
    expect(chainErrorMessage("notRecorded")).toBe(pendingActionCopy.notRecorded);
    expect(refusalMessage({ reason: "portfolioNotSaved" }, "mobile")).toBe(
      "The new portfolio could not be saved on this phone.",
    );
  });

  it("never names SOL in what the phone says about moving money in", () => {
    for (const text of strings(mobileFundingCopy)) expect(text).not.toMatch(/\bSOL\b/);
    for (const text of strings(mobileSendCopy)) expect(text).not.toMatch(/\bSOL\b/);
  });

  it("says trackers, not stocks, about a pie", () => {
    for (const text of strings([
      pieCopy,
      mobilePieCopy,
      portfolioCopy.card,
      portfolioCopy.create,
    ])) {
      expect(text).not.toMatch(/\bstocks?\b/i);
    }
    expect(pieCopy.problems.empty).toBe("Add at least one tracker.");
    expect(portfolioCopy.card.pie(3)).toBe("Pie · 3 trackers");
  });

  it("has no em dash on either platform", () => {
    const text = JSON.stringify(
      strings([
        onboardingCopy,
        walletCopy,
        activityCopy,
        earnCopy,
        errorsCopy,
        fundingCopy,
        marketsCopy,
        pendingActionCopy,
        pieCopy,
        portfolioCopy,
        sendCopy,
        tradeCopy,
        PHONE,
      ]),
    );
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
