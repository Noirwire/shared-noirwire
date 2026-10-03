import { describe, expect, it } from "vitest";
import { mobileOnboardingCopy, onboardingCopy } from "../../src/copy/onboarding.js";
import { mobileWalletCopy, walletCopy } from "../../src/copy/wallet.js";
import { appCopy } from "../../src/copy/app.js";
import { commonCopy } from "../../src/copy/common.js";
import { networkCostCopy } from "../../src/copy/networkCost.js";
import { mobileSettingsCopy, settingsCopy } from "../../src/copy/settings.js";
import { waitingCopy } from "../../src/copy/waiting.js";
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
  mobileSettingsCopy,
  mobileWalletCopy,
];

const WEB = [
  appCopy,
  commonCopy,
  onboardingCopy,
  walletCopy,
  settingsCopy,
  activityCopy,
  earnCopy,
  errorsCopy,
  fundingCopy,
  marketsCopy,
  networkCostCopy,
  pendingActionCopy,
  pieCopy,
  portfolioCopy,
  sendCopy,
  tradeCopy,
  waitingCopy,
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

  it("keeps the web's wording exactly where settings, unlock and reset became templates", () => {
    expect(settingsCopy.saveFailing).toBe(
      "Changes are not being saved in this browser (storage is full or blocked). What you see here will be gone after a reload. Your funds are not affected.",
    );
    expect(settingsCopy.password.changed).toBe(
      "Password changed. Use the new one next time you unlock. This protects the copy in this browser only: if you think someone already copied this wallet, move your funds to a new recovery phrase.",
    );
    expect(walletCopy.resetConfirm.warning).toBe(
      "This deletes the wallet from this browser. Your recovery phrase is the only way back in. Without it, everything in your funding wallet and in every portfolio is gone for good, and nobody can restore it.",
    );
    expect(walletCopy.store.damaged).toBe(
      "The wallet stored in this browser cannot be read. Reset it and import it again from your recovery phrase.",
    );
    expect(walletCopy.store.noWallet).toBe("There is no wallet in this browser.");
  });

  it("carries the words the web app used to keep for itself", () => {
    expect(walletCopy.reset.notRemoved).toBe(
      "This browser would not delete the wallet. It is still on this device, locked. Try again.",
    );
    expect(walletCopy.crossTab.notice).toBe(
      "This browser cannot keep your wallet safe across tabs, so nothing can be changed or sent from here. You can still look. To use your wallet, open it in a current browser.",
    );
    expect(walletCopy.crossTab.refused).toBe(
      "This browser cannot keep your wallet safe across tabs, so nothing was changed or sent. Open your wallet in a current browser.",
    );
  });

  it("says settings, unlock and reset in the phone's words", () => {
    expect(mobileSettingsCopy.saveFailing).toBe(
      "Changes are not being saved on this phone (storage is full or blocked). What you see here will be gone when the app closes. Your funds are not affected.",
    );
    expect(mobileSettingsCopy.password.changed).toMatch(/protects the copy on this phone only/);
    expect(mobileSettingsCopy.biometric.changed("face ID")).toBe(
      "Face ID settings changed on this phone, so this was turned off. Turn it on again to keep using it.",
    );
    expect(mobileWalletCopy.unlock.lead).toBe(
      "Your wallet is stored encrypted on this phone, so it has to be unlocked each time the app opens.",
    );
    expect(mobileWalletCopy.unlock.lockedOut("fingerprint")).toBe(
      "Fingerprint is unavailable right now. Enter your password.",
    );
    expect(mobileWalletCopy.resetConfirm.warning).toMatch(
      /^This deletes the wallet from this phone\./,
    );
    expect(mobileWalletCopy.reset).toEqual({
      notRemoved:
        "The wallet could not be deleted from this phone (storage is blocked). It is still stored here, locked. Try again.",
      deleting: "Deleting...",
    });
  });

  it("says what happened, what it means for the money and what to do, never how the app asked", () => {
    const changed: [string, string][] = [
      [
        onboardingCopy.import.networkFailed,
        "We couldn't finish importing your wallet. Nothing was saved in this browser. Try again.",
      ],
      [onboardingCopy.import.checking, "Finding your portfolios..."],
      [
        mobileOnboardingCopy.import.networkFailed,
        "We couldn't finish importing your wallet. Nothing was saved on this phone. Try again.",
      ],
      [
        mobileOnboardingCopy.import.offline,
        "You're offline. Nothing was saved on this phone. Go back online to import your wallet.",
      ],
      [
        onboardingCopy.password.encryptFailed,
        "We couldn't encrypt your wallet, so nothing was saved. Try again.",
      ],
      [
        appCopy.networkGate.wrongNetwork("Solana mainnet"),
        "NoirWire is not connected to Solana mainnet as it should be. Your money has not moved, and nothing can be sent until this is fixed. Try again later.",
      ],
      [
        appCopy.networkGate.unreachable,
        "We can't show your balances right now. Your money has not moved. Try again.",
      ],
      [mobileAppCopy.network.checking, "Getting things ready..."],
      [
        errorsCopy.chain.noQuote,
        "There is no price for this order right now. Nothing was traded. Try again in a moment.",
      ],
      [
        errorsCopy.chain.wrongNetwork,
        "NoirWire is not connected to Solana as it should be, so this was stopped. Nothing was signed or sent. Try again later.",
      ],
      [errorsCopy.funding.failed, "We couldn't move this money. Nothing was moved. Try again."],
      [
        errorsCopy.funding.privateNotStarted,
        "The private transfer could not be started. Nothing left your funding wallet. Try again.",
      ],
      [
        errorsCopy.send.notCompleted,
        "This send can't be made. Nothing was sent. Check the amount and the recipient's address.",
      ],
      [errorsCopy.send.failed, "We couldn't complete this send. Nothing was sent. Try again."],
      [
        errorsCopy.trade.noPrice,
        "We couldn't get a price for this trade. Nothing was traded. Try again.",
      ],
      [errorsCopy.earn.failed, "This did not go through. Nothing was moved. Try again."],
      [sendCopy.sending, "Sending..."],
      [
        tradeCopy.costCheckFailed,
        "We couldn't work out the network cost of this order. Nothing was charged. Get a new price.",
      ],
      [
        pieCopy.order.costCheckFailed,
        "We couldn't work out the network cost of these orders. Nothing was charged. Try again.",
      ],
      [
        mobilePortfolioCopy.home.refreshFailed,
        "We couldn't update your balances. What you see may be out of date. Pull down to try again.",
      ],
      [
        mobilePortfolioCopy.detail.refreshFailed,
        "We couldn't update your balances. What you see may be out of date. Pull down to try again.",
      ],
      [
        mobileFundingCopy.page.readFailed,
        "We couldn't update your balance. What you see may be out of date. Pull down to try again.",
      ],
    ];
    for (const [said, expected] of changed) expect(said).toBe(expected);
    expect(fundingCopy.unknown("10.00 USDC", "USDC", "Investing")).toMatch(
      /^The transfer of 10\.00 USDC was sent, but we could not confirm that it arrived\. It may still arrive\./,
    );
  });

  it("never blames a request, a service or a timeout on either platform", () => {
    const blame =
      /could not reach|couldn't reach|did not answer|never came back|timed out|time out|rate limit|\bAPI\b|\bRPC\b|\bHTTP\b|\bendpoint\b/i;
    for (const text of strings([WEB, PHONE])) expect(text).not.toMatch(blame);
  });

  it("names no request, server or provider in a failure or a waiting message", () => {
    const technical =
      /\brequests?\b|\bserver\b|\bprovider\b|\brelay(er|ed)?\b|\bJupiter\b|\bMagicBlock\b/i;
    const failuresAndWaiting = [
      errorsCopy,
      mobileErrorsCopy,
      waitingCopy,
      appCopy.networkGate,
      mobileAppCopy,
      pendingActionCopy,
      mobilePendingActionCopy,
      walletCopy.store,
      mobileWalletCopy.store,
      onboardingCopy.import.progress,
      mobileOnboardingCopy.import.progress,
      networkCostCopy.notNow,
      networkCostCopy.noPrice,
    ];
    for (const text of strings(failuresAndWaiting)) expect(text).not.toMatch(technical);
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
        WEB,
        PHONE,
      ]),
    );
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
