import { describe, expect, it } from "vitest";
import {
  createPortfolio,
  portfolioNameTaken,
} from "../../src/application/actions/createPortfolio.js";
import { createCatalog } from "../../src/application/catalog.js";
import { earnDraft } from "../../src/application/earn.js";
import { fundingDraft } from "../../src/application/funding.js";
import { sendDraft } from "../../src/application/send.js";
import { tradeDraft } from "../../src/application/trade.js";
import { activityCopy } from "../../src/copy/activity.js";
import { marketsCopy } from "../../src/copy/markets.js";
import { networkCostCopy } from "../../src/copy/networkCost.js";
import { pieCopy } from "../../src/copy/pie.js";
import { plural } from "../../src/copy/plural.js";
import { mobileFundingCopy } from "../../src/copy/funding.js";
import { portfolioCopy } from "../../src/copy/portfolio.js";
import { mobileSendCopy, sendCopy } from "../../src/copy/send.js";
import { settingsCopy } from "../../src/copy/settings.js";
import { tradeCopy } from "../../src/copy/trade.js";
import { walletCopy } from "../../src/copy/wallet.js";
import { smallestAmount, tooPrecise } from "../../src/domain/amount.js";
import type { Portfolio } from "../../src/domain/wallet.js";
import { findStock, stockBySymbol } from "../../src/infrastructure/solana/tokenRegistry.js";
import { refusalMessage } from "../../src/presentation/actionResult.js";
import { earnAmountView } from "../../src/presentation/earn.js";
import { fundingAmountView } from "../../src/presentation/funding.js";
import { sendFormView } from "../../src/presentation/send.js";
import { privacySectionHelp } from "../../src/presentation/settings.js";
import { tradeFormView } from "../../src/presentation/trade.js";
import { harness } from "./support/actions.js";
import { READ } from "./support/screens.js";

describe("counted nouns", () => {
  it("go through one helper, which says one of a thing in the singular", () => {
    expect(plural(1, "asset")).toBe("1 asset");
    expect(plural(0, "asset")).toBe("0 assets");
    expect(plural(2, "asset")).toBe("2 assets");
  });

  it("never read as one of many, anywhere a count is said", () => {
    const one = [
      portfolioCopy.home.assets(1),
      marketsCopy.assets(1),
      marketsCopy.results(1),
      pieCopy.problems.tooMany(1),
      pieCopy.order.allPlaced(1),
      pieCopy.order.somePlaced(0, 1),
      pieCopy.order.place(1),
      pieCopy.mix.trackers(1),
      networkCostCopy.openingSeveral(1),
      walletCopy.copyButton.clearing(1),
      tradeCopy.heldFor(1),
      mobileFundingCopy.stages[1].caption(0, 1),
      portfolioCopy.card.investments(1),
      portfolioCopy.home.portfolioLine.holdings("1.00 USDC", 1),
      activityCopy.olderNotKept(1),
    ];
    for (const text of one) expect(text).not.toMatch(/\b1 [a-z]+s\b(?! placed)/);
    expect(portfolioCopy.home.assets(1)).toBe("1 asset");
    expect(marketsCopy.results(1)).toBe("1 result");
    expect(marketsCopy.results(3)).toBe("3 results");
    expect(pieCopy.order.allPlaced(1)).toBe("Order placed");
    expect(pieCopy.order.allPlaced(3)).toBe("All 3 orders placed");
    expect(pieCopy.order.somePlaced(1, 3)).toBe("1 of 3 orders placed");
    expect(walletCopy.copyButton.clearing(30)).toMatch(/in 30 seconds;/);
    expect(tradeCopy.heldFor(1)).toBe("Price held for 1 second.");
  });
});

describe("an amount that is not one", () => {
  it("is answered with an example, in plain words, on both platforms", () => {
    expect(sendCopy.invalidAmount).toBe("Enter an amount, like 12.50.");
    expect(mobileSendCopy.invalidAmount).toBe("Enter an amount, like 12.50.");
    expect(sendCopy.invalidAmount).not.toMatch(/finite/);
  });
});

describe("an amount with more decimals than the asset has", () => {
  it("is told apart from one that fits, trailing zeros aside", () => {
    expect(tooPrecise("1.234567", 6)).toBe(false);
    expect(tooPrecise("1.2345670", 6)).toBe(false);
    expect(tooPrecise("1.2345678", 6)).toBe(true);
    expect(tooPrecise("0,0000001", 6)).toBe(true);
    expect(tooPrecise("12", 0)).toBe(false);
    expect(tooPrecise("12.5", 0)).toBe(true);
    expect(tooPrecise("abc", 6)).toBe(false);
    expect(smallestAmount(6)).toBe("0.000001");
    expect(smallestAmount(2)).toBe("0.01");
    expect(smallestAmount(0)).toBe("1");
  });

  const sendState = (amountText: string) => {
    const input = {
      heldRaw: 50,
      unitsPerHeld: 1,
      amountText,
      decimals: 6,
      destination: "Recipient111",
      isAddress: true,
      offCurve: false,
      ownAddress: "Portfolio111",
    };
    return sendFormView({
      draft: sendDraft(input),
      symbol: "USDC",
      unitsPerHeld: 1,
      heldRaw: 50,
      decimals: 6,
      destination: input.destination,
      ownAddress: input.ownAddress,
      offCurve: false,
      offCurveMessage: "",
      recipientTouched: true,
      amountTouched: true,
      archived: false,
      submitting: false,
      preparing: false,
      pastedForeign: false,
      unsendable: null,
      network: "Solana",
      balances: READ,
    } as Parameters<typeof sendFormView>[0]);
  };

  it("is refused in a send, naming the smallest amount, and cannot be reviewed", () => {
    expect(sendDraft({ ...baseSend, amountText: "1.2345678" })).toMatchObject({
      validAmount: false,
      tooPrecise: true,
      amount: 0,
      rawAmount: 0,
    });
    const below = sendState("0.0000001");
    expect(below.amountError).toBe(
      "That amount has too many decimals. The smallest amount is 0.000001 USDC.",
    );
    expect(below.canReview).toBe(false);
    expect(sendState("0.000001")).toMatchObject({ amountError: null, canReview: true });
    expect(sendState("abc").amountError).toBe("Enter an amount, like 12.50.");
  });

  it("is refused when moving money in, in Earn and in a trade", () => {
    const funding = fundingDraft({
      privateRoute: false,
      decimals: 6,
      fundingBalance: 100,
      amountText: "1.0000001",
    });
    expect(funding).toMatchObject({ tooPrecise: true, amountValid: false, canFund: false });

    const lent = earnDraft({
      action: "deposit",
      amountText: "1.0000001",
      cash: 50,
      deposited: 0,
      cost: null,
    });
    expect(lent).toMatchObject({ tooPrecise: true, valid: false });
    expect(
      earnAmountView({
        action: "deposit",
        draft: lent,
        portfolioLabel: "Main",
        amountText: "1.0000001",
        cost: null,
        apy: 5,
        online: true,
      }).validation,
    ).toBe("That amount has too many decimals. The smallest amount is 0.000001 USDC.");

    const trade = (denom: "cash" | "units", amountText: string) => {
      const draft = tradeDraft({
        side: "buy",
        denom,
        amountText,
        cash: 100,
        heldRaw: 0,
        unitsPerHeld: 1,
        displayPrice: 10,
        decimals: 8,
      });
      return tradeFormView({
        draft,
        side: "buy",
        denom,
        symbol: "NVDAx",
        cash: 100,
        displayLive: true,
        quoting: false,
        balances: READ,
      });
    };
    expect(trade("cash", "10.1234567")).toMatchObject({
      tooPrecise: "That amount has too many decimals. The smallest amount is 0.000001 USDC.",
      action: { kind: "review", disabled: true },
    });
    expect(trade("units", "1.123456789").tooPrecise).toBe(
      "That amount has too many decimals. The smallest amount is 0.00000001 NVDAx.",
    );
    expect(trade("units", "1.12345678")).toMatchObject({
      tooPrecise: null,
      action: { disabled: false },
    });
  });
});

const baseSend = {
  heldRaw: 50,
  unitsPerHeld: 1,
  amountText: "1",
  decimals: 6,
  destination: "Recipient111",
  isAddress: true,
  offCurve: false,
  ownAddress: "Portfolio111",
};

describe("the funding amount field", () => {
  const view = (amountText: string, touched?: boolean) =>
    fundingAmountView({
      draft: fundingDraft({ privateRoute: true, decimals: 6, fundingBalance: 20, amountText }),
      asset: "USDC",
      privateRoute: true,
      fundingBalance: 20,
      readFailed: false,
      amountText,
      decimals: 6,
      presets: [10, 25],
      pending: { blocked: false },
      ...(touched === undefined ? {} : { touched }),
    });

  it("shows no error before the person has typed, whatever the field holds", () => {
    expect(view("", false)).toMatchObject({ invalid: null, unaffordable: null });
    expect(view("999", false)).toMatchObject({ invalid: null, unaffordable: null });
    expect(view("0.1", false)).toMatchObject({ invalid: null, unaffordable: null });
  });

  it("says what is wrong once they have", () => {
    expect(view("999", true).invalid).toBe(
      "Enter an amount greater than zero and within your available balance.",
    );
    expect(view("0.1", true).unaffordable).toMatch(/has to be at least/);
    expect(view("1.0000001", true).invalid).toBe(
      "That amount has too many decimals. The smallest amount is 0.000001 USDC.",
    );
    expect(view("", true).invalid).toBeNull();
  });

  it("takes the field as typed in when it is not told, as before", () => {
    expect(view("999").invalid).not.toBeNull();
  });
});

describe("finding a tracker by its symbol", () => {
  it("is case-insensitive through the one finder", () => {
    const exact = findStock("NVDAx");
    expect(exact?.symbol).toBe("NVDAx");
    for (const typed of ["nvdax", "NVDAX", "NvDaX", " nvdax "]) {
      expect(findStock(typed)).toBe(exact);
      expect(stockBySymbol(typed)).toBe(exact);
    }
    expect(findStock("nope")).toBeUndefined();
  });

  it("is the same in the catalog the screens read", () => {
    const catalog = createCatalog({
      stocks: [findStock("NVDAx")!],
      livePrice: () => ({ usd: 100, change24h: 1 }),
      stockMultiplier: () => 1,
    });
    expect(catalog.canonicalSymbol("nvdax")).toBe("NVDAx");
    expect(catalog.canonicalSymbol("usdc")).toBe("USDC");
    expect(catalog.canonicalSymbol("nope")).toBeUndefined();
    expect(catalog.asset("nvdax")).toMatchObject({ symbol: "NVDAx", price: 100 });
    expect(catalog.isPosition("NVDAX")).toBe(true);
  });
});

describe("a portfolio name already in use", () => {
  const newPortfolio = (label: string, address: string, derivationIndex: number): Portfolio => ({
    id: `new_${derivationIndex}`,
    label,
    address,
    derivationIndex,
    createdAt: 2,
    archivedAt: null,
    holdings: [],
  });
  const create = (h: ReturnType<typeof harness>, label: string) =>
    createPortfolio(
      { ...h.deps, newPortfolio, fundingIndex: 0, pieProblem: () => null },
      { label },
    );

  it("is refused, whatever its capitals or spaces, archived portfolios included", async () => {
    const h = harness();
    const before = h.wallet().portfolios.length;
    for (const label of ["Main", "main", "  MAIN ", "Old"]) {
      expect(await create(h, label)).toMatchObject({ kind: "refused", reason: "duplicateName" });
    }
    expect(h.wallet().portfolios).toHaveLength(before);
    expect((await create(h, "Savings")).kind).toBe("created");
    expect(await create(h, "savings")).toMatchObject({ reason: "duplicateName" });
  });

  it("says so in plain words on both platforms, and lets a rename keep its own name", () => {
    for (const platform of ["web", "mobile"] as const) {
      expect(refusalMessage({ reason: "duplicateName" }, platform)).toBe(
        "You already have a portfolio with that name. Choose another name.",
      );
    }
    const wallet = harness().wallet();
    expect(portfolioNameTaken(wallet, "main")).toBe(true);
    expect(portfolioNameTaken(wallet, "main", "p1")).toBe(false);
    expect(portfolioNameTaken(wallet, "Old", "p1")).toBe(true);
    expect(portfolioNameTaken(wallet, "New")).toBe(false);
  });
});

describe("the Privacy heading in Settings", () => {
  it("promises a control over usage analytics only where there is one", () => {
    expect(privacySectionHelp({ analyticsControl: true })).toBe(
      "Understand what is public and control usage analytics.",
    );
    expect(privacySectionHelp({ analyticsControl: false })).toBe("Understand what is public.");
    expect(settingsCopy.sections.privacy.helpWithoutAnalytics).not.toMatch(/analytics/);
  });
});

describe("the Risks row in Settings", () => {
  it("says what the page is about, without a word on how often it is said", () => {
    expect(settingsCopy.risks.description).not.toMatch(/\bonce\b|stated/i);
  });
});
