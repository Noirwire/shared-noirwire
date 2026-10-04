import { describe, expect, it } from "vitest";
import { mobileOnboardingCopy, onboardingCopy } from "../../src/copy/onboarding.js";
import { mobileWalletCopy, walletCopy } from "../../src/copy/wallet.js";
import { appCopy } from "../../src/copy/app.js";
import { commonCopy } from "../../src/copy/common.js";
import { networkCostCopy } from "../../src/copy/networkCost.js";
import { mobileSettingsCopy, settingsCopy } from "../../src/copy/settings.js";
import { mobileWaitingCopy, waitingCopy } from "../../src/copy/waiting.js";
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
  mobileWaitingCopy,
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
 * The names the product stopped using, each with the name that took its
 * place. One term per thing, on both platforms.
 */
const REPLACED_NAMES: [RegExp, string][] = [
  [/add usdc/i, 'bringing money in is "Add money"'],
  [/\bfund\w* (\w+ )?privately/i, 'moving money into a portfolio is "Move to portfolio"'],
  [/private route/i, 'the noun is "private move"'],
  [/private transfer/i, 'the noun is "private move"'],
  [/move money here/i, 'the button is "Move to portfolio"'],
  [/add money privately/i, 'the confirm is "Move privately"'],
  [/funding address/i, 'the thing is the "funding wallet"; an address is what is copied'],
  [/deposit address/i, 'the thing is the "funding wallet"'],
  [/\bcash\b/, '"Cash" is only a row label; the money is USDC'],
  [/\bstocks\b/i, 'what a person holds is a "tracker"'],
  [/indicative/i, 'a shown price is "Approximate"'],
  [/\bexchanges?\b/i, "no service for buying USDC is named or pointed to"],
];

/** Every use of a replaced name in `copy`, as "why: the string". */
function replacedNamesIn(copy: unknown): string[] {
  return strings(copy).flatMap((text) =>
    REPLACED_NAMES.filter(([term]) => term.test(text)).map(([, why]) => `${why}: ${text}`),
  );
}

/**
 * Phrasing the product led with before: what NoirWire lacks or cannot do in
 * the main path, instead of the working route stated as steps. Each entry is
 * a sentence that was once in the everyday copy and the positive form that
 * replaced it.
 */
const PRODUCT_LIMITATION_PHRASES: [RegExp, string][] = [
  [
    /cannot take card payments/i,
    "the add-money step says how to get USDC, not what NoirWire cannot take",
  ],
  [/\bunavailable on\b/i, "a network that does not run a feature says where it does run"],
  [/\bmainnet only\b/i, "a network that does not run a feature says where it does run"],
  [/\bonly available on\b/i, "a network that does not run a feature says where it does run"],
  [/\bnot supported\b/i, "say what to do instead of naming what isn't supported"],
];

/** Every use of a limitation-first phrase in `copy`, as "why: the string". */
function productLimitationsIn(copy: unknown): string[] {
  return strings(copy).flatMap((text) =>
    PRODUCT_LIMITATION_PHRASES.filter(([term]) => term.test(text)).map(
      ([, why]) => `${why}: ${text}`,
    ),
  );
}

/** A copy object without the named sections. */
function without<T extends object>(copy: T, ...sections: (keyof T)[]): Partial<T> {
  return Object.fromEntries(
    Object.entries(copy).filter(([key]) => !sections.includes(key as keyof T)),
  ) as Partial<T>;
}

/**
 * Everything both platforms say, but for the Privacy and Risks pages. Those
 * state what is public and what can go wrong in their own, longer words, and
 * are kept as they were.
 */
const EVERYDAY = [
  WEB.filter((copy) => copy !== settingsCopy),
  PHONE.filter((copy) => copy !== mobileSettingsCopy),
  without(settingsCopy, "protection", "risks"),
  without(mobileSettingsCopy, "privacy", "risks"),
];

/**
 * The web's strings are built from the same templates as the phone's. These
 * pin the web's wording byte for byte, so a template change cannot move it.
 */
describe("per-platform copy", () => {
  it("keeps the web's wording exactly", () => {
    expect(onboardingCopy.password.intro(12)).toBe(
      "Choose a password of at least 12 characters. It locks the wallet in this browser. We never see it.",
    );
    expect(onboardingCopy.phrase.intro).toBe(
      "These words are the only way back into your money if this device is lost. Write them on paper. Anyone who sees them can take everything.",
    );
    expect(walletCopy.store.notSaved).toBe(
      "This browser would not save the wallet (storage is full or blocked). Nothing was changed.",
    );
  });

  it("says the same on the phone with the phone's words", () => {
    expect(mobileOnboardingCopy.password.intro(12)).toBe(
      "Choose a password of at least 12 characters. It locks the wallet on this phone. We never see it.",
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
      "These stay in this browser. Balance reads and trades go through NoirWire's own server, so the network provider, Jupiter and MagicBlock see this address but never your IP address. The server keeps only a basic record that a request was made, not your address or what's in it, but you have to trust it keeps nothing more.",
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
        "The private move could not be started. Nothing left your funding wallet. Try again.",
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

  it("says a request the server would not take in the person's terms, the same on both", () => {
    const said = chainErrorMessage("notAvailableNow");
    expect(said).toBe(
      "We can't do this right now. Nothing was sent, and your money has not moved. Try again.",
    );
    expect(chainErrorMessage("notAvailableNow", "mobile")).toBe(said);
    expect(said).not.toMatch(/token|session|auth|sign.?in|\bAPI\b|server|401/i);
  });

  it("holds the words each app used to keep for itself", () => {
    const moved: [string, string][] = [
      [waitingCopy.overdue.review, "We couldn't prepare your review. Nothing was sent. Try again."],
      [
        waitingCopy.overdue.action,
        "This is taking much longer than it should. It may still go through. You can close this and check Activity before trying again.",
      ],
      [
        waitingCopy.overdue.save,
        "Saving your wallet is taking much longer than it should. It is still being saved. Keep this tab open.",
      ],
      [waitingCopy.actionHeld, "This is still being carried out, so it can't be closed yet."],
      [waitingCopy.gettingReady, "Getting things ready..."],
      [
        onboardingCopy.import.notNow,
        "We can't look for your wallet right now, so nothing was imported. Nothing was saved in this browser.",
      ],
      [portfolioCopy.balances.updating, "Updating balances..."],
      [
        portfolioCopy.balances.stale,
        "We couldn't update your balances. What you see may be out of date.",
      ],
      [
        marketsCopy.pricesUnavailable,
        "Prices can't be shown right now. They are checked again every 30 seconds.",
      ],
      [
        portfolioCopy.archived.value("$12.00"),
        "Plus $12.00 in archived portfolios, not counted above.",
      ],
      [
        portfolioCopy.archived.valueUnpriced,
        "Archived portfolios still hold investments, not counted above.",
      ],
      [
        portfolioCopy.archived.earnNotIncluded,
        "What archived portfolios have in Earn can't be read right now and is not included.",
      ],
      [
        portfolioCopy.archived.earnUnknown,
        "What it has in Earn can't be shown right now, and is hidden with it.",
      ],
      [
        portfolioCopy.archived.earnUnknownAlone,
        "What this portfolio has in Earn can't be shown right now. Archiving hides it; it does not move anything.",
      ],
      [portfolioCopy.archived.heldIn("Investing"), "Investing (archived)"],
      [portfolioCopy.archived.confirm, "Archive anyway"],
      [portfolioCopy.archived.keep, "Keep it"],
      [
        onboardingCopy.phrase.discarded,
        "This page was reloaded, so the recovery phrase you were shown before was discarded. It was never saved. A wallet created now gets a new phrase, and it has to be written down again.",
      ],
      [
        onboardingCopy.phrase.newPhrase,
        "This is a new recovery phrase. Words written down before the reload do not open this wallet.",
      ],
      [
        onboardingCopy.phrase.acknowledgeNew,
        "I understand the earlier phrase is gone and I will write this one down.",
      ],
      [
        appCopy.offline.blocked,
        "That page can't be opened while you're offline. You are still on this one.",
      ],
      [
        appCopy.offline.walletReady,
        "Your wallet is saved and unlocked. It opens as soon as you're back online.",
      ],
      [earnCopy.unread, "What is in Earn can't be shown right now."],
      [
        earnCopy.notHere("Solana devnet"),
        "Earn runs on Solana mainnet. Switch from Solana devnet to lend or withdraw.",
      ],
      [mobileWalletCopy.newPassword.checkFailed, "Could not check this password. Type it again."],
      [mobilePortfolioCopy.create.forExample("Investing"), "For example: Investing"],
      [mobilePortfolioCopy.create.nameNeeded, "Type a name first."],
      [commonCopy.tryAgain, "Try again"],
      [waitingCopy.overdue.check, "We couldn't check this. Nothing was sent. Try again."],
      [
        mobileWaitingCopy.overdue.action,
        "This is taking longer than it should. It may still go through, so check the balance and Activity before doing it again.",
      ],
      [
        mobileWaitingCopy.overdue.prices,
        "We couldn't load prices. They are missing or out of date here, and are asked for again every half minute.",
      ],
      [mobileWaitingCopy.overdue.chart, "We couldn't load this chart."],
      [
        mobileWaitingCopy.overdue.earn,
        "We couldn't update what is in Earn. What you see may be out of date.",
      ],
      [mobileWaitingCopy.overdue.fundingBalance, "We couldn't read your funding wallet's balance."],
    ];
    for (const [said, expected] of moved) expect(said).toBe(expected);
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
      mobileWaitingCopy,
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

  it("uses one name for each thing on both platforms, and none of the names it replaced", () => {
    expect(replacedNamesIn(EVERYDAY)).toEqual([]);
  });

  it("keeps Cash as a row label only", () => {
    const labels = ["Cash", "Cash available", "Cash and other holdings"];
    for (const text of strings(EVERYDAY)) {
      if (/cash/i.test(text)) expect(labels).toContain(text);
    }
  });

  it("refuses a replaced name wherever it is put back", () => {
    expect(replacedNamesIn({ home: { addUsdc: "Add USDC" } })).toHaveLength(1);
    expect(replacedNamesIn({ line: (amount: string) => `${amount} cash` })).toHaveLength(1);
    expect(replacedNamesIn({ lead: "Fund it through the private route." })).toHaveLength(1);
    expect(replacedNamesIn({ tag: "Indicative", shelf: "Stocks" })).toHaveLength(2);
    expect(replacedNamesIn({ step: "Buy it on an exchange you already use." })).toHaveLength(1);
    expect(replacedNamesIn({ label: "Cash", button: "Move to portfolio" })).toEqual([]);
  });

  it("never leads with what NoirWire lacks or cannot do in the main path", () => {
    expect(productLimitationsIn(EVERYDAY)).toEqual([]);
  });

  it("refuses a limitation-first sentence wherever it is put back", () => {
    expect(productLimitationsIn({ step: "NoirWire cannot take card payments yet." })).toHaveLength(
      1,
    );
    expect(
      productLimitationsIn({
        line: (network: string) => `Live trading is unavailable on ${network}.`,
      }),
    ).toHaveLength(1);
    expect(
      productLimitationsIn({ line: "Earn is available on Solana mainnet only." }),
    ).toHaveLength(1);
    expect(
      productLimitationsIn({ line: "Live trading is only available on mainnet." }),
    ).toHaveLength(1);
    expect(productLimitationsIn({ line: "That payment method is not supported." })).toHaveLength(1);
    expect(productLimitationsIn({ line: "Earn runs on Solana mainnet." })).toEqual([]);
  });

  it("says each first-time-user decision in its exact words", () => {
    expect(onboardingCopy.welcome.title).toBe("Invest in US stock trackers. Privately.");
    expect(onboardingCopy.welcome.lines).toEqual([
      "Trackers follow share prices like Apple, Tesla or the S&P 500. You do not own the shares.",
      "Each portfolio is separate from your funding wallet. Trades themselves are public.",
    ]);
    expect([
      onboardingCopy.welcome.create,
      onboardingCopy.welcome.restore,
      onboardingCopy.welcome.explore,
    ]).toEqual(["Create a wallet", "Restore a wallet", "Explore trackers"]);
    expect(onboardingCopy.welcome.trust).toBe(
      "No account and no ID check. Only your recovery words can restore your wallet.",
    );
    expect(portfolioCopy.home.onlyYouSee).toBe("Only you see this total");
    expect(portfolioCopy.home.readyToInvest).toBe("Ready to invest");
    expect(portfolioCopy.home.addMoney).toBe("Add money");
    expect(portfolioCopy.home.moneyArrives).toBe(
      "Your money arrives in your funding wallet. Then you move it into a portfolio.",
    );
    expect(portfolioCopy.addMoney.title).toBe("Add digital dollars");
    expect(portfolioCopy.addMoney.steps.get.detail("Solana")).toBe(
      "USDC is a digital dollar: 1 USDC = $1. Send it from any app or wallet that supports USDC on the Solana network. You do not need an account with us.",
    );
    expect(portfolioCopy.addMoney.steps.send.detail("Solana")).toBe(
      "Copy the address below. In the other app choose USDC and the Solana network, and check the address before sending. This transfer is public.",
    );
    expect(portfolioCopy.addMoney.steps.move.detail("0.1% + $0.20")).toBe(
      "When it arrives, choose a portfolio and tap Move to portfolio. A private move is not linked to your funding wallet in the public record. It costs 0.1% + $0.20. It usually arrives within a minute and can take a few.",
    );
    expect(portfolioCopy.addMoney.network("Solana")).toBe("Network: Solana");
    expect(portfolioCopy.addMoney.costsLink).toBe("What does it cost?");
    expect(portfolioCopy.detail.moveToPortfolio).toBe("Move to portfolio");
    expect(fundingCopy.titlePrivate).toBe("Move to portfolio");
    expect(fundingCopy.confirmPrivate).toBe("Move privately");
    expect(mobileFundingCopy.page.move).toBe("Move to portfolio");
    expect(networkCostCopy.moveToPortfolio).toBe("Move to portfolio");
    expect(settingsCopy.costs.title).toBe("Costs");
    expect(settingsCopy.costs.trade("0.5")).toBe("Buying or selling a tracker: 0.5% of the trade.");
    expect(settingsCopy.costs.move("0.1% + $0.20")).toBe(
      "Moving money into a portfolio privately: 0.1% + $0.20. It usually arrives within a minute and can take a few.",
    );
    expect(settingsCopy.costs.network).toBe(
      "Network cost: a few cents, paid automatically from your USDC.",
    );
    expect(settingsCopy.costs.gettingUsdc).toBe(
      "Getting USDC from another service: that service may charge its own fee.",
    );
    expect(settingsCopy.costs.exact).toBe("The exact amount is always shown before you confirm.");
    expect(marketsCopy.detail.trackerLine("NVIDIA", "NVDAx")).toBe("NVIDIA tracker · NVDAx");
    expect(marketsCopy.detail.follows("NVIDIA")).toBe(
      "Follows NVIDIA's share price. You do not own a share.",
    );
    expect(marketsCopy.detail.approximate).toBe("Approximate price");
    expect(marketsCopy.detail.finalPrice).toBe("The final price is shown before you buy.");
    expect(marketsCopy.detail.issuerPowers).toBe(
      "The company that issues this tracker can freeze or remove it.",
    );
    expect(marketsCopy.detail.noChart).toBe("Chart unavailable right now.");
    expect(appCopy.networkGate.cannotReach).toBe(
      "Can't reach NoirWire. Check your connection and try again.",
    );
    expect(onboardingCopy.import.waitingNote).toBe(
      "Checking what this phrase holds. This can take up to a minute.",
    );
    expect(onboardingCopy.import.lookFurther.continuePaused).toBe(
      "Continue is paused while we look.",
    );
    expect(onboardingCopy.import.newEmptyWallet).toBe(
      "Nothing found yet. This phrase will open a new, empty wallet.",
    );
    expect(tradeCopy.noMoney).toBe("No money in this portfolio yet");
    expect(mobileSettingsCopy.about).toMatchObject({
      helpContact: "ph1l1ph@proton.me",
      websiteValue: "noirwire.com",
    });
  });

  it("gives each app leftover a shared home, with web and phone variants only where they differ", () => {
    expect(commonCopy.showLabel("the recovery phrase")).toBe("Show the recovery phrase");
    expect(commonCopy.hideLabel("the recovery phrase")).toBe("Hide the recovery phrase");
    expect(commonCopy.increaseLabel("the weight")).toBe("Increase the weight");
    expect(commonCopy.decreaseLabel("the weight")).toBe("Decrease the weight");
    expect(commonCopy.percentSpoken(42)).toBe("42 percent");
    expect(commonCopy.closeLabel("Add digital dollars")).toBe("Close Add digital dollars");
    expect(commonCopy.nothingHereYet).toBe("Nothing here yet");
    expect(commonCopy.discardThis).toBe("Discard this?");
    expect(commonCopy.keepEditing).toBe("Keep editing");
    expect(commonCopy.discard).toBe("Discard");
    expect(commonCopy.stepStatus).toEqual({
      waiting: "Waiting",
      current: "In progress",
      done: "Done",
      failed: "Failed",
      skipped: "Not done",
    });
    expect(commonCopy.andList(["SOL"])).toBe("SOL");
    expect(commonCopy.andList(["SOL", "USDC"])).toBe("SOL and USDC");
    expect(commonCopy.andList(["SOL", "USDC", "SPYx"])).toBe("SOL, USDC and SPYx");
    expect(commonCopy.andList([])).toBe("");

    expect(marketsCopy.detail.chartHint).toBe("Hover to see the price and date.");
    expect(mobileMarketsCopy.detail.chartHint).toBe("Press and hold to see the price and date.");

    expect(mobileOnboardingCopy.phrase.wordLabel(1, "abandon")).toBe("Word 1, abandon");
    expect(mobileOnboardingCopy.phrase.copy.confirmTitle).toBe("Copy the recovery phrase?");
    expect(mobileOnboardingCopy.phrase.copy.confirmBody(30)).toBe(
      "Other apps and keyboards on this phone can read the clipboard, and it may sync to your other devices. It is cleared after 30 seconds.",
    );
    expect(mobileOnboardingCopy.phrase.copy.copiedNote(30)).toBe(
      "Copied. The clipboard is cleared in 30 seconds; copy something else to be sure.",
    );

    expect(mobileWalletCopy.protection.refused).toBe(
      "This can't be shown safely right now, so it is kept hidden. Try again.",
    );

    expect(mobileSendCopy.camera).toEqual({
      purpose: "NoirWire uses the camera only to scan a QR code you point it at.",
      allow: "Allow camera",
      off: "Camera access is off.",
      offDetail:
        "Allow the camera in system settings to scan a code, or paste the address instead.",
      openSettings: "Open settings",
    });

    expect(mobileAppCopy.runtimeFailure.title).toBe("NoirWire cannot run safely on this device");
    expect(mobileAppCopy.runtimeFailure.configFailure).toBe("App configuration");
  });

  it("leaves what was already good as it was", () => {
    expect(mobileOnboardingCopy.confirm.checkWord(5)).toBe("Check word 5 on your paper.");
    expect(onboardingCopy.phrase.neverAsked).toBe(
      "NoirWire never asks for these words. Nobody from NoirWire will ever ask you for them.",
    );
    expect(activityCopy.empty).toBe("Your buys, sells and money moves will appear here.");
    expect(portfolioCopy.balances.stale).toBe(
      "We couldn't update your balances. What you see may be out of date.",
    );
    expect(appCopy.networkGate.unreachable).toBe(
      "We can't show your balances right now. Your money has not moved. Try again.",
    );
  });
});
