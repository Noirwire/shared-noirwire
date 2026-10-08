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
import { rewardsCopy } from "../../src/copy/rewards.js";
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
  rewardsCopy,
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
  [
    /funding (wallet|address|balance)/i,
    'the thing is the "main wallet"; an address is what is copied',
  ],
  [/deposit address/i, 'the thing is the "main wallet"'],
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

/** A copy object without the named sections. A dotted name reaches into a nested one. */
function without<T extends object>(copy: T, ...sections: string[]): Partial<T> {
  const nested = (prefix: string) =>
    sections
      .filter((section) => section.startsWith(`${prefix}.`))
      .map((section) => section.slice(prefix.length + 1));
  return Object.fromEntries(
    Object.entries(copy)
      .filter(([key]) => !sections.includes(key))
      .map(([key, value]) =>
        nested(key).length > 0 ? [key, without(value as object, ...nested(key))] : [key, value],
      ),
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
 * The main path: the everyday copy without what sits behind "Read the
 * risks" (what kind of certificate a tracker is, what its issuer can do,
 * who the USDC in Earn is lent through) and without a portfolio's own
 * privacy panel, which says who sees its address.
 */
const MAIN_PATH = [
  WEB.filter(
    (copy) =>
      copy !== settingsCopy && copy !== marketsCopy && copy !== tradeCopy && copy !== portfolioCopy,
  ),
  PHONE.filter((copy) => copy !== mobileSettingsCopy && copy !== mobilePortfolioCopy),
  without(settingsCopy, "protection", "risks"),
  without(mobileSettingsCopy, "privacy", "risks"),
  without(marketsCopy, "detail.aboutTracker", "detail.issuerPowers", "detail.issuerDetails"),
  without(tradeCopy, "tracker"),
  without(portfolioCopy, "observer"),
  without(mobilePortfolioCopy, "publicView"),
];

/**
 * Plain words. Each entry is a word the everyday screens stopped using, the
 * word that took its place, and where the rule holds: `everywhere` (every
 * string on both platforms), `everyday` (all but the Privacy and Risks
 * pages) or `mainPath` (the everyday copy without what is behind "Read the
 * risks").
 */
const PLAIN_WORDS: [RegExp, string, "everywhere" | "everyday" | "mainPath"][] = [
  [/\bon[- ]?chain\b/i, 'say "in public" or "publicly"', "everyday"],
  [/\bderiv\w*/i, 'say "comes from"', "everyday"],
  [/\bpassphrase\b/i, 'say "password"', "everyday"],
  [/\bencrypt(ing)? and\b|^(re-)?encrypting\b/i, 'the button is "Save and finish"', "everyday"],
  [/\bimport(s|ed|ing)?\b/i, 'bringing a wallet back is "Restore"', "everywhere"],
  [/\b(devnet|mainnet)\b/i, 'say "test network" or "main network"', "everywhere"],
  [/(?<!bank )\bdeposit(s|ed|ing)?\b/i, 'putting USDC into Earn is "Add to Earn"', "everyday"],
  [/^at review$|^no live price$/i, 'a missing price is "Price unavailable right now."', "everyday"],
  [
    /\bJupiter\b/i,
    'Earn is titled "Earn"; who it lends through is under "Read the risks"',
    "mainPath",
  ],
  [/\bxStocks\b|\bissuers?\b|\bcertificates?\b/i, 'behind "Read the risks"', "mainPath"],
];

const SCOPES = { everywhere: [WEB, PHONE], everyday: EVERYDAY, mainPath: MAIN_PATH };

/** Every use of a retired word in `copy` under the rules of `scope`, as "why: the string". */
function plainWordsBrokenIn(copy: unknown, scope: keyof typeof SCOPES): string[] {
  const rules = PLAIN_WORDS.filter(([, , where]) => where === scope);
  return strings(copy).flatMap((text) =>
    rules.filter(([term]) => term.test(text)).map(([, why]) => `${why}: ${text}`),
  );
}

/** `web` with the platform's words swapped for the phone's. */
const onPhone = (web: string) =>
  web
    .replaceAll("in this browser", "on this phone")
    .replaceAll("this browser", "this phone")
    .replaceAll("This browser", "This phone")
    .replaceAll("this device", "this phone");

describe("per-platform copy", () => {
  it("says the same on the web and on the phone, but for the platform's own words", () => {
    const pairs: [string, string][] = [
      [onboardingCopy.password.intro(12), mobileOnboardingCopy.password.intro(12)],
      [onboardingCopy.phrase.intro, mobileOnboardingCopy.phrase.intro],
      [walletCopy.store.notSaved, mobileOnboardingCopy.password.notSaved],
      [walletCopy.store.damaged, mobileWalletCopy.store.damaged],
      [walletCopy.store.noWallet, mobileWalletCopy.store.noWallet],
      [walletCopy.resetConfirm.warning, mobileWalletCopy.resetConfirm.warning],
      [settingsCopy.password.changed, mobileSettingsCopy.password.changed],
      [portfolioCopy.create.lead, mobilePortfolioCopy.create.lead],
      [portfolioCopy.create.notSaved, mobilePortfolioCopy.create.notSaved],
      [portfolioCopy.observer.relayed, mobilePortfolioCopy.publicView.relayed],
      [portfolioCopy.home.togetherExplained, mobilePortfolioCopy.home.togetherExplained],
      [pendingActionCopy.notRecorded, mobilePendingActionCopy.notRecorded],
      [onboardingCopy.import.networkFailed, mobileOnboardingCopy.import.networkFailed],
      [activityCopy.importedNote, mobileActivityCopy.importedNote],
      [activityCopy.detail.recorded, mobileActivityCopy.detail.recorded],
      [activityCopy.olderNotKept(3), mobileActivityCopy.olderNotKept(3)],
      [pieCopy.edit.saveFailed, mobilePieCopy.builder.saveFailed],
      [fundingCopy.footerPrivate, mobileFundingCopy.footer],
    ];
    for (const [web, phone] of pairs) {
      expect(phone).toBe(onPhone(web));
    }
  });

  it("puts a method name at the start of a sentence with a capital", () => {
    expect(mobileOnboardingCopy.biometric.notTurnedOn("fingerprint")).toMatch(/^Fingerprint /);
    expect(mobileSettingsCopy.biometric.changed("face ID")).toMatch(/^Face ID /);
    expect(mobileWalletCopy.unlock.lockedOut("fingerprint")).toMatch(/^Fingerprint /);
  });

  it("says, in every failure, what it means for the person's money", () => {
    const failures = [
      onboardingCopy.import.networkFailed,
      mobileOnboardingCopy.import.networkFailed,
      mobileOnboardingCopy.import.offline,
      onboardingCopy.import.notNow,
      onboardingCopy.password.encryptFailed,
      appCopy.networkGate.wrongNetwork("Solana"),
      appCopy.networkGate.unreachable,
      errorsCopy.chain.noQuote,
      errorsCopy.chain.wrongNetwork,
      errorsCopy.chain.notAvailableNow,
      errorsCopy.funding.failed,
      errorsCopy.funding.privateNotStarted,
      errorsCopy.send.notCompleted,
      errorsCopy.send.failed,
      errorsCopy.trade.noPrice,
      errorsCopy.earn.failed,
      tradeCopy.costCheckFailed,
      pieCopy.order.costCheckFailed,
      waitingCopy.overdue.check,
      waitingCopy.overdue.review,
    ];
    const meansForMoney =
      /nothing (was|can be|left)|money has not moved|nothing has been|nothing can be sent/i;
    for (const text of failures) expect(text).toMatch(meansForMoney);
  });

  it("says a request the server would not take in the person's terms, the same on both", () => {
    const said = chainErrorMessage("notAvailableNow");
    expect(chainErrorMessage("notAvailableNow", "mobile")).toBe(said);
    expect(said).not.toMatch(/token|session|auth|sign.?in|\bAPI\b|server|401/i);
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

  it("never says browser on the phone, in its own copy or in a refusal chosen for it", () => {
    for (const text of strings(PHONE)) expect(text).not.toMatch(/browser/i);
    expect(chainErrorMessage("notRecorded", "mobile")).toBe(mobilePendingActionCopy.notRecorded);
    expect(chainErrorMessage("notRecorded")).toBe(pendingActionCopy.notRecorded);
    expect(refusalMessage({ reason: "portfolioNotSaved" }, "mobile")).toBe(
      mobileErrorsCopy.portfolioNotSaved,
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
  });

  it("has no em dash on either platform", () => {
    expect(JSON.stringify(strings([WEB, PHONE]))).not.toContain(String.fromCharCode(0x2014));
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
    expect(replacedNamesIn({ row: "Funding wallet" })).toHaveLength(1);
    expect(replacedNamesIn({ label: "Cash", button: "Move to portfolio" })).toEqual([]);
  });

  it("calls the wallet money arrives in the main wallet everywhere, the Privacy and Risks pages included", () => {
    const all = strings([WEB, PHONE]);
    expect(all.filter((text) => /funding wallet/i.test(text))).toEqual([]);
    expect(all.some((text) => /main wallet/i.test(text))).toBe(true);
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
    expect(productLimitationsIn({ line: "Earn is available on the main network only." })).toEqual(
      [],
    );
    expect(productLimitationsIn({ line: "Earn is mainnet only." })).toHaveLength(1);
    expect(
      productLimitationsIn({ line: "Live trading is only available on the main network." }),
    ).toHaveLength(1);
    expect(productLimitationsIn({ line: "That payment method is not supported." })).toHaveLength(1);
    expect(productLimitationsIn({ line: "Earn runs on the main network." })).toEqual([]);
  });

  it("says the fee, or that there is none, and never that it is shown somewhere else", () => {
    for (const text of strings(settingsCopy.costs)) {
      expect(text).not.toMatch(/fee is shown|shown in the review/i);
    }
  });

  it("uses plain words on every screen: none of the words it retired", () => {
    for (const scope of ["everywhere", "everyday", "mainPath"] as const) {
      expect(plainWordsBrokenIn(SCOPES[scope], scope)).toEqual([]);
    }
  });

  it("refuses a retired word wherever it is put back", () => {
    const everyday = (copy: unknown) => plainWordsBrokenIn(copy, "everyday");
    expect(everyday({ note: "The transfer itself is public on chain." })).toHaveLength(1);
    expect(everyday({ note: "No owner label onchain" })).toHaveLength(1);
    expect(everyday({ lead: "An address derived from your recovery phrase." })).toHaveLength(1);
    expect(everyday({ lead: "Every portfolio this wallet derives." })).toHaveLength(1);
    expect(everyday({ button: "Suggest a passphrase" })).toHaveLength(1);
    expect(everyday({ button: "Encrypt and finish", busy: "Encrypting..." })).toHaveLength(2);
    expect(
      everyday({ button: "Deposit", done: (amount: string) => `Deposited ${amount}` }),
    ).toHaveLength(2);
    expect(everyday({ risk: "It is not a bank deposit." })).toEqual([]);
    expect(everyday({ price: "At review", change: "No live price" })).toHaveLength(2);
    expect(everyday({ note: "Your order price is shown at review." })).toEqual([]);

    const everywhere = (copy: unknown) => plainWordsBrokenIn(copy, "everywhere");
    expect(
      everywhere({ title: "Import an existing wallet.", done: "Wallet imported." }),
    ).toHaveLength(2);
    expect(
      everywhere({ banner: "Never send mainnet funds", tag: "Devnet SOL only." }),
    ).toHaveLength(2);
    expect(everywhere({ banner: "Test network", line: "Earn runs on the main network." })).toEqual(
      [],
    );

    const mainPath = (copy: unknown) => plainWordsBrokenIn(copy, "mainPath");
    expect(mainPath({ eyebrow: "Earn · Jupiter Lend" })).toHaveLength(1);
    expect(mainPath({ about: "NVDAx is an xStocks tracker certificate." })).toHaveLength(1);
    expect(mainPath({ line: "Its issuer keeps control over it." })).toHaveLength(1);
  });

  it("keeps what is behind Read the risks out of the scan, and nothing else", () => {
    const scanned = strings(MAIN_PATH);
    expect(scanned).not.toContain(marketsCopy.detail.issuerPowers);
    expect(scanned).not.toContain(tradeCopy.tracker.notOffered);
    expect(scanned).toContain(marketsCopy.detail.publicTrades);
    expect(scanned).toContain(tradeCopy.publicLine);
    expect(scanned).toContain(earnCopy.title);
    expect(scanned).toContain(portfolioCopy.home.addMoney);
  });

  it("says ready to invest on every portfolio row, a pie's included", () => {
    expect(portfolioCopy.home.portfolioLine.pie(2, "$0.00")).toMatch(/\$0\.00 ready to invest$/);
    expect(portfolioCopy.home.portfolioLine.holdings("$0.00", 1)).toMatch(
      /^\$0\.00 ready to invest/,
    );
  });

  it("uses one word, Restore, for bringing a wallet back", () => {
    expect(onboardingCopy.welcome.restore).toMatch(/^Restore\b/);
    expect(onboardingCopy.import.title).toMatch(/^Restore\b/);
    expect(onboardingCopy.import.submit).toMatch(/^Restore\b/);
    expect(onboardingCopy.import.importedTitle).toMatch(/restored/);
    expect(onboardingCopy.import.reunitedTitle).toMatch(/restored/);
    expect(onboardingCopy.import.progress.title).toMatch(/^Restoring\b/);
  });

  it("still states every risk on the Risks and Privacy pages", () => {
    const pages = [
      strings(settingsCopy.risks).join(" "),
      strings(mobileSettingsCopy.risks).join(" "),
    ];
    for (const page of pages) {
      expect(page).toMatch(/not a share/i);
      expect(page).toMatch(/issuer.*freeze/i);
      expect(page).toMatch(/public on chain/i);
      expect(page).toMatch(/not insured/i);
      expect(page).toMatch(/Jupiter Lend/);
      expect(page).toMatch(/not been (independently )?audited/i);
      expect(page).toMatch(/only your recovery phrase/i);
    }
    const privacy = [
      strings(settingsCopy.protection).join(" "),
      strings(mobileSettingsCopy.privacy).join(" "),
    ];
    for (const page of privacy) {
      expect(page).toMatch(/trades (are|stay) public/i);
      expect(page).toMatch(/does not make (it|them) invisible/i);
      expect(page).toMatch(/never leave this (browser|phone)/i);
      expect(page).toMatch(/you have to trust it keeps nothing more/i);
    }
  });

  it("joins a list the way a sentence does", () => {
    expect(commonCopy.andList([])).toBe("");
    expect(commonCopy.andList(["SOL"])).toBe("SOL");
    expect(commonCopy.andList(["SOL", "USDC"])).toBe("SOL and USDC");
    expect(commonCopy.andList(["SOL", "USDC", "SPYx"])).toBe("SOL, USDC and SPYx");
  });
});
