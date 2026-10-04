import { describe, expect, it } from "vitest";
import { earnDraft } from "../../../src/application/earn.js";
import { fundingDraft } from "../../../src/application/funding.js";
import { sendDraft } from "../../../src/application/send.js";
import { tradeDraft } from "../../../src/application/trade.js";
import { hasLoaded, recordRead, type ReadFreshness } from "../../../src/domain/freshness.js";
import {
  earnPortfolioView,
  earnScreenView,
  earnSheetView,
  type EarnPortfolio,
} from "../../../src/presentation/earn.js";
import { balancesView } from "../../../src/presentation/freshness.js";
import { choosePortfolioView, fundingAmountView } from "../../../src/presentation/funding.js";
import { pieInvestView } from "../../../src/presentation/pie.js";
import {
  portfolioRowView,
  portfolioView,
  type PortfolioDetailView,
} from "../../../src/presentation/portfolio.js";
import { sendFormView } from "../../../src/presentation/send.js";
import { portfolioChoices, tradeFormView } from "../../../src/presentation/trade.js";
import {
  FIRST_READ_FAILED,
  FIRST_READ_PENDING,
  READ,
  UPDATED_AT,
  holding,
  testReads,
  withFirst,
  withHolding,
} from "../support/screens.js";

const reads = testReads();

/** A portfolio that really holds cash and a tracker: none of it may show until balances are read. */
const wallet = withFirst((first) =>
  withHolding(withHolding(first, holding("USDC", 40)), holding("NVDAx", 1, 90)),
);
const pieWallet = withFirst((first) => ({
  ...withHolding(first, holding("USDC", 40)),
  pie: [
    { symbol: "NVDAx", weight: 50 },
    { symbol: "SPYx", weight: 50 },
  ],
}));

function page(balances: ReadFreshness, from = wallet): PortfolioDetailView {
  const view = portfolioView(reads, from, from.portfolios[0].id, UPDATED_AT, balances);
  if (view.kind !== "found") throw new Error("expected a portfolio");
  return view;
}

describe("balancesView", () => {
  it("is unavailable, with a retry, only for a first read that failed", () => {
    expect(balancesView(FIRST_READ_FAILED)).toMatchObject({ known: false, loading: false });
    expect(balancesView(FIRST_READ_FAILED).unavailable?.retry).toBeTruthy();
    expect(balancesView(FIRST_READ_PENDING)).toEqual({
      known: false,
      loading: true,
      unavailable: null,
      reason: null,
    });
  });

  it("stays known once loaded, however the latest refresh went", () => {
    const failedLater = recordRead(READ, false, UPDATED_AT + 1);
    expect(hasLoaded(failedLater)).toBe(true);
    expect(balancesView(failedLater)).toEqual({
      known: true,
      loading: false,
      unavailable: null,
      reason: null,
    });
  });

  it("gives a held-back action the same reason the screen states", () => {
    const view = balancesView(FIRST_READ_FAILED);
    expect(view.reason).toBe(view.unavailable?.text);
  });
});

describe("a portfolio row, before balances are read", () => {
  it("is its name and its mark, with no value and no line about money", () => {
    const row = portfolioRowView(reads, wallet.portfolios[0], UPDATED_AT, FIRST_READ_FAILED);
    expect(row).toMatchObject({ line: null, value: null, change: null, spoken: "Investing" });
  });

  it("shows its value once they are", () => {
    const row = portfolioRowView(reads, wallet.portfolios[0], UPDATED_AT, READ);
    expect(row.value).toBe("$140.00");
  });
});

describe("a portfolio's page, before balances are read", () => {
  it("shows no value, no cash and no holdings, and says balances could not be loaded", () => {
    const view = page(FIRST_READ_FAILED);
    expect([view.value, view.cashLine, view.holdings]).toEqual([null, null, null]);
    expect(view.valueUnavailable).toBe(true);
    expect(view.unavailable).not.toBeNull();
    expect(view.loading).toBe(false);
  });

  it("does not call a portfolio it has not read empty", () => {
    const view = page(
      FIRST_READ_FAILED,
      withFirst((first) => first),
    );
    expect(view.empty).toBeNull();
  });

  it("holds back everything that needs a balance, with the reason, and leaves Receive", () => {
    const view = page(FIRST_READ_FAILED);
    expect(view.primary).toBeNull();
    expect(view.rebalance).toBeNull();
    const pressable = view.quiet.filter((button) => !button.disabled);
    expect(pressable.map((button) => button.action.to)).toEqual(["receive"]);
    const held = view.quiet.filter((button) => button.disabled);
    expect(held.length).toBeGreaterThan(0);
    for (const button of held) expect(button.reason).toBe(view.unavailable?.text);
    expect(view.sendReason).toBe(view.unavailable?.text);
  });

  it("waits, saying nothing, while the first read is under way", () => {
    const view = page(FIRST_READ_PENDING);
    expect(view).toMatchObject({ value: null, cashLine: null, loading: true, unavailable: null });
  });

  it("keeps a pie's targets and says nothing of what was or was not bought", () => {
    const mix = page(FIRST_READ_FAILED, pieWallet).mix;
    expect(mix?.target).toEqual([50, 50]);
    expect(mix?.current).toBeUndefined();
    expect(mix?.slices.map((slice) => slice.trailing)).toEqual([null, null]);
  });

  it("shows the figures again once balances have loaded, even after a later refresh fails", () => {
    const view = page(recordRead(READ, false, UPDATED_AT + 1));
    expect(view.value).toBe("$140.00");
    expect(view.unavailable).toBeNull();
    expect(view.holdings?.rows.length).toBe(2);
  });
});

describe("sending, before balances are read", () => {
  const form = (balances: ReadFreshness) =>
    sendFormView({
      draft: sendDraft({
        heldRaw: 100,
        unitsPerHeld: 1,
        amountText: "10",
        destination: "Recipient1111111111111111111111111111111WXYZ",
        isAddress: true,
        offCurve: false,
        ownAddress: "Own",
      }),
      symbol: "USDC",
      heldRaw: 100,
      unitsPerHeld: 1,
      destination: "Recipient1111111111111111111111111111111WXYZ",
      ownAddress: "Own",
      offCurve: false,
      offCurveMessage: "",
      recipientTouched: true,
      amountTouched: true,
      archived: false,
      submitting: false,
      preparing: false,
      network: "Solana",
      balances,
    });

  it("shows no balance and cannot be reviewed, with the reason", () => {
    const view = form(FIRST_READ_FAILED);
    expect([view.amountLine, view.available.value]).toEqual([null, null]);
    expect(view.canReview).toBe(false);
    expect(view.review.disabled).toBe(true);
    expect(view.balanceUnavailable).toBe(balancesView(FIRST_READ_FAILED).reason);
  });

  it("can be reviewed once they are", () => {
    expect(form(READ)).toMatchObject({ canReview: true, balanceUnavailable: null });
  });
});

describe("buying and selling, before balances are read", () => {
  const form = (balances: ReadFreshness, cash: number) =>
    tradeFormView({
      draft: tradeDraft({
        side: "buy",
        denom: "cash",
        amountText: "10",
        cash,
        heldRaw: 0,
        unitsPerHeld: 1,
        displayPrice: 25,
      }),
      side: "buy",
      denom: "cash",
      symbol: "NVDAx",
      cash,
      displayLive: true,
      quoting: false,
      balances,
    });

  it("shows no cash and holds the review back, with the reason", () => {
    const view = form(FIRST_READ_FAILED, 100);
    expect(view.available).toBeNull();
    expect(view.action).toMatchObject({ kind: "review", disabled: true });
    expect(view.balanceUnavailable).toBe(balancesView(FIRST_READ_FAILED).reason);
  });

  it("does not send someone to add money over cash it has not read", () => {
    expect(form(FIRST_READ_FAILED, 0).action.kind).toBe("review");
    expect(form(READ, 0).action.kind).toBe("addMoney");
  });

  it("names the portfolios to choose from without a figure beside them", () => {
    const captions = (balances: ReadFreshness) =>
      portfolioChoices(reads, wallet, "buy", null, balances).map((choice) => choice.caption);
    expect(captions(FIRST_READ_FAILED)).toEqual([null]);
    expect(captions(READ)).toEqual(["40.00 USDC available"]);
  });

  it("holds a pie's invest step back the same way", () => {
    const invest = (balances: ReadFreshness) =>
      pieInvestView({
        amount: 30,
        cash: 50,
        preview: [{ symbol: "NVDAx", usd: 30 }],
        priced: true,
        nameOf: (symbol) => symbol,
        balances,
      });
    expect(invest(FIRST_READ_FAILED)).toMatchObject({
      available: null,
      split: null,
      review: { disabled: true },
    });
    expect(invest(FIRST_READ_FAILED).balanceUnavailable).not.toBeNull();
    expect(invest(READ).review.disabled).toBe(false);
  });
});

describe("moving money into a portfolio, before the funding wallet is read", () => {
  const amount = (fundingBalance: number | null, readFailed: boolean) =>
    fundingAmountView({
      draft: fundingDraft({
        privateRoute: true,
        decimals: 6,
        fundingBalance: fundingBalance ?? 0,
        amountText: "10",
      }),
      asset: "USDC",
      privateRoute: true,
      fundingBalance,
      readFailed,
      amountText: "10",
      presets: [10, 25],
      pending: { blocked: false },
    });

  it("names no balance, not even a zero in its lead, and cannot go on", () => {
    const view = amount(null, true);
    expect(view.available.value).toBeNull();
    expect(view.lead).not.toMatch(/\d/);
    expect(view.next.disabled).toBe(true);
    expect(view.unavailable).not.toBeNull();
  });

  it("does not say the amount is more than a balance it has not read", () => {
    const view = amount(null, true);
    expect([view.unaffordable, view.empty]).toEqual([null, null]);
  });

  it("waits without the line while the read is still under way", () => {
    expect(amount(null, false).unavailable).toBeNull();
  });

  it("says nothing of a failed refresh over a balance it already has", () => {
    const view = amount(100, true);
    expect(view.unavailable).toBeNull();
    expect(view.available.value).toBe("100.00 USDC");
  });

  it("lists the portfolios to choose from without their cash", () => {
    const rows = (balances: ReadFreshness) =>
      choosePortfolioView({
        portfolios: [{ id: "a", label: "Investing", cash: 5 }],
        chosen: null,
        balances,
      }).rows.map((row) => row.cash);
    expect(rows(FIRST_READ_FAILED)).toEqual([null]);
    expect(rows(READ)).toEqual(["5.00 USDC ready to invest"]);
  });
});

describe("Earn, before balances are read", () => {
  const portfolios: EarnPortfolio[] = [
    {
      id: "a",
      label: "Investing",
      archived: false,
      cash: 20,
      position: { deposited: 10, earnedSinceDeposit: 0.5 },
    },
  ];
  const screen = (balances: ReadFreshness) =>
    earnScreenView({
      available: true,
      online: true,
      venue: "Jupiter Lend",
      rate: { apy: 5, supplyApy: 4, rewardsApy: 1 },
      portfolios,
      platform: "mobile",
      balances,
    });

  it("shows no cash on a row, opens nothing, and says balances could not be loaded", () => {
    const view = screen(FIRST_READ_FAILED);
    expect(view.rows.map((row) => [row.cash, row.opens])).toEqual([[null, null]]);
    expect(view.unavailable).not.toBeNull();
  });

  it("holds adding and withdrawing back, with that reason and not 'move money in first'", () => {
    const view = screen(FIRST_READ_FAILED);
    expect(view.deposit).toMatchObject({ disabled: true, reason: view.unavailable?.text });
    expect(view.withdraw?.disabled).toBe(true);
  });

  it("opens again once balances have loaded", () => {
    const view = screen(READ);
    expect(view.rows[0]).toMatchObject({ cash: "$20.00 ready to invest", opens: "deposit" });
    expect(view.deposit?.disabled).toBe(false);
  });

  it("allows nothing from a single portfolio's row either", () => {
    const row = earnPortfolioView({
      archived: false,
      available: true,
      cash: 20,
      position: portfolios[0].position ?? null,
      balances: FIRST_READ_FAILED,
    });
    expect(row).toMatchObject({
      cash: null,
      cashAvailable: null,
      canDeposit: false,
      canWithdraw: false,
    });
  });

  it("confirms nothing on the sheet, and shows no amount available", () => {
    const sheet = (balances: ReadFreshness) =>
      earnSheetView({
        action: "deposit",
        draft: earnDraft({
          action: "deposit",
          amountText: "10",
          cash: 50,
          deposited: 20,
          cost: { kind: "covered" },
        }),
        portfolioLabel: "Investing",
        archived: false,
        available: true,
        positionKnown: true,
        needsKnown: true,
        apy: 5,
        cost: { kind: "covered" },
        pending: { blocked: false },
        busy: false,
        balances,
      });
    expect(sheet(FIRST_READ_FAILED)).toMatchObject({
      available: null,
      confirm: { disabled: true },
    });
    expect(sheet(FIRST_READ_FAILED).balanceUnavailable).not.toBeNull();
    expect(sheet(READ).confirm.disabled).toBe(false);
  });
});
