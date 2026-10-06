import { describe, expect, it } from "vitest";
import type { LivePrice } from "../../../src/application/catalog.js";
import { fundingDraft, type FundingInput } from "../../../src/application/funding.js";
import { recordRead } from "../../../src/domain/freshness.js";
import type { Activity, Wallet } from "../../../src/domain/wallet.js";
import type { HomeFreshness } from "../../../src/presentation/freshness.js";
import {
  fundingAmountView,
  fundingFooter,
  fundingOutcomeView,
  fundingProgressView,
  fundingReviewView,
  fundingTitle,
  fundingWalletView,
  type FundingAmountState,
} from "../../../src/presentation/funding.js";
import {
  FIRST_READ_FAILED,
  FIRST_READ_PENDING,
  FRESH,
  READ,
  TEST_PRICES,
  UPDATED_AT,
  activity,
  testReads,
  testWallet,
} from "../support/screens.js";

const draft = (overrides: Partial<FundingInput> = {}) =>
  fundingDraft({
    privateRoute: true,
    decimals: 6,
    fundingBalance: 20,
    amountText: "",
    ...overrides,
  });

const amountView = (
  overrides: Partial<FundingAmountState> = {},
  input: Partial<FundingInput> = {},
) =>
  fundingAmountView({
    draft: draft(input),
    asset: "USDC",
    privateRoute: true,
    fundingBalance: 20,
    readFailed: false,
    amountText: input.amountText ?? "",
    presets: [10, 25],
    pending: { blocked: false },
    ...overrides,
  });

describe("fundingDraft", () => {
  it("adds the privacy and relay fees on the private route, and enforces its minimum", () => {
    const funding = draft({ amountText: "10" });
    expect(funding.minimum).toBe(0.5);
    expect(funding.leaving(10)).toBe(10.21);
    expect(funding.affordable(10)).toBe(true);
    expect(funding.affordable(0.4)).toBe(false);
    expect(funding.affordable(19.9)).toBe(false);
    expect(funding.canFund).toBe(true);
  });

  it("moves exactly the amount on the public route", () => {
    const funding = draft({ privateRoute: false, decimals: 0, amountText: "20" });
    expect(funding.minimum).toBe(0);
    expect(funding.leaving(20)).toBe(20);
    expect(funding.canFund).toBe(true);
  });

  it("rejects an amount over the balance or not above zero", () => {
    expect(draft({ amountText: "25" }).amountValid).toBe(false);
    expect(draft({ amountText: "0" }).amountValid).toBe(false);
    expect(draft({ amountText: "abc" }).canFund).toBe(false);
  });
});

describe("fundingTitle and fundingFooter", () => {
  it("calls only the private route private", () => {
    expect(fundingTitle("USDC", true)).toBe("Move to portfolio");
    expect(fundingTitle("SOL", false)).toBe("Move SOL publicly");
    expect(fundingFooter(true)).toMatch(/^A private move breaks the public link/);
    expect(fundingFooter(false)).toBe("This is an ordinary, fully public transfer.");
  });
});

describe("fundingAmountView", () => {
  it("offers the presets it can afford and states the private route's costs", () => {
    const view = amountView();
    expect(view.lead).toBe(
      "Move USDC into this portfolio without publishing a transfer between your main wallet and it. Available 20.00 USDC.",
    );
    expect(view.noPrivateRoute).toBeNull();
    expect(view.presets).toEqual([
      { value: 10, label: "10.00 USDC", disabled: false },
      { value: 25, label: "25.00 USDC", disabled: true },
    ]);
    expect(view.otherAmount).toBe("Other amount in USDC");
    expect(view.next).toEqual({ label: "Continue", disabled: true });
    expect(view.costs).toBe(
      "Costs a 0.1% privacy fee plus a flat 0.20 USDC relay fee, both charged in USDC by the settlement service on top of the amount. The relay fee pays the network costs, so your main wallet needs no SOL. The smallest private move is 0.50 USDC. It usually arrives within a minute and can take a few.",
    );
    expect(view.empty).toBeNull();
  });

  it("warns that SOL goes as a public transfer", () => {
    const view = amountView(
      { asset: "SOL", privateRoute: false, fundingBalance: 1, presets: [0.05] },
      { privateRoute: false, decimals: 0, fundingBalance: 1 },
    );
    expect(view.lead).toBe("Move SOL into this portfolio. Available 1.0000 SOL.");
    expect(view.noPrivateRoute).toMatch(/^SOL cannot be moved privately\./);
    expect(view.presets).toEqual([{ value: 0.05, label: "0.0500 SOL", disabled: false }]);
    expect(view.costs).toBeNull();
  });

  it("says what is wrong with a typed amount", () => {
    expect(amountView({}, { amountText: "50" }).invalid).toBe(
      "Enter an amount greater than zero and within your available balance.",
    );
    expect(amountView({}, { amountText: "0.3" }).unaffordable).toBe(
      "A private move has to be at least 0.50 USDC.",
    );
    expect(amountView({}, { amountText: "19.9" }).unaffordable).toBe(
      "With fees this takes 20.1199 USDC from your main wallet, more than it holds. Enter a smaller amount.",
    );
    expect(amountView({}, { amountText: "10" }).next).toEqual({
      label: "Continue",
      disabled: false,
    });
    expect(amountView({ pending: { blocked: true } }, { amountText: "10" }).next.disabled).toBe(
      true,
    );
  });

  it("states the fees to the same decimal the review does, so 0.025 is not 0.03 in one and 0.025 in the other", () => {
    const form = amountView({ fundingBalance: 100 }, { amountText: "25", fundingBalance: 100 });
    const review = fundingReviewView({
      draft: draft({ fundingBalance: 100 }),
      asset: "USDC",
      amount: 25,
      portfolioLabel: "Investing",
      pending: { blocked: false },
    });
    expect(form.terms.map((term) => term.value)).toEqual(review.terms.map((term) => term.value));
    expect(form.total.value).toBe(review.total.value);
    expect(form.terms[1].value).toBe("0.025 USDC");
    expect(form.total.value).toBe("25.225 USDC");
  });

  it("points an empty main wallet to its own address", () => {
    expect(amountView({ fundingBalance: 0 }, { fundingBalance: 0 }).empty).toEqual({
      before: "Your main wallet holds no USDC. ",
      link: "Show your main wallet address",
      after: " to add money first.",
    });
  });
});

describe("fundingReviewView", () => {
  it("lists everything that leaves the main wallet, exactly", () => {
    const view = fundingReviewView({
      draft: draft(),
      asset: "USDC",
      amount: 10,
      portfolioLabel: "Investing",
      pending: { blocked: false },
    });
    expect(view.lead).toBe(
      "Review what leaves your main wallet before moving money into Investing.",
    );
    expect(view.terms).toEqual([
      { label: "Arrives in Investing", value: "10.00 USDC" },
      { label: "Privacy fee (0.1%)", value: "0.01 USDC" },
      { label: "Relay fee", value: "0.20 USDC" },
    ]);
    expect(view.total).toEqual({ label: "Total leaving your main wallet", value: "10.21 USDC" });
    expect(view.note).toBe(
      "No SOL is needed. If the transfer would take more than this total, it is not signed.",
    );
    expect(view.confirm).toEqual({ label: "Move privately", disabled: false });
    expect(
      fundingReviewView({
        draft: draft(),
        asset: "USDC",
        amount: 10,
        portfolioLabel: "Investing",
        pending: { blocked: true },
      }).confirm.disabled,
    ).toBe(true);
  });
});

describe("fundingProgressView", () => {
  it("marks each stage done, running or still to come", () => {
    const view = fundingProgressView({
      asset: "USDC",
      amount: 10,
      portfolioLabel: "Investing",
      completed: 1,
    });
    expect(view.title).toBe("Moving 10.00 USDC into Investing");
    expect(view.stages.map((stage) => stage.status)).toEqual(["done", "running", "pending"]);
    expect(view.stages[1].detail).toBe("Delivered after 2-15s, split across several entries.");
  });
});

describe("fundingWalletView", () => {
  const SOL_PRICED = { ...TEST_PRICES, SOL: { usd: 200, change24h: 0 } };
  const holding = (usdc: number, sol = 0, entries: Activity[] = []) =>
    testWallet((wallet) => ({
      ...wallet,
      funding: { ...wallet.funding, sol, tokens: { USDC: usdc, NVDAx: 4 } },
      activity: entries,
    }));
  const page = (
    wallet: Wallet,
    freshness: Partial<HomeFreshness> = {},
    prices: Record<string, LivePrice> = SOL_PRICED,
  ) => fundingWalletView(testReads(prices), wallet, UPDATED_AT, { ...FRESH, ...freshness });

  it("waits, with no figure and nothing to press but Receive and Add money, while the first read is under way", () => {
    const view = page(holding(25, 0.5), { balances: FIRST_READ_PENDING });
    expect(view).toMatchObject({
      title: "Main wallet",
      total: { label: "Balance", value: null },
      assets: [],
      empty: null,
      loading: true,
      unavailable: null,
      stale: null,
      move: { disabled: true, reason: null },
      send: { disabled: true, reason: null },
      receive: { disabled: false },
      addMoney: { disabled: false },
    });
    expect(JSON.stringify(view)).not.toContain("$0.00");
  });

  it("says balances could not be loaded, with a retry, after a failed first read", () => {
    const view = page(holding(25), { balances: FIRST_READ_FAILED });
    expect(view.unavailable).toEqual({
      text: "We couldn't load your balances. Check your connection and try again.",
      retry: "Try again",
    });
    expect(view).toMatchObject({ loading: false, stale: null, empty: null, assets: [] });
    expect(view.total.value).toBeNull();
    expect(view.move).toMatchObject({ disabled: true, reason: view.unavailable?.text });
    expect(view.send).toMatchObject({ disabled: true, reason: view.unavailable?.text });
  });

  it("says an empty wallet is empty once that was read, and leads to adding money", () => {
    const view = page(holding(0));
    expect(view.empty).toBe("Your main wallet is empty. Add money to get started.");
    expect(view.total.value).toBe("$0.00");
    expect(view.assets).toEqual([{ symbol: "USDC", amount: "0.00 USDC", value: "$0.00" }]);
    expect(view.move).toEqual({
      label: "Move to portfolio",
      target: { to: "fund" },
      disabled: true,
      reason: "Add money to your main wallet first.",
    });
    expect(view.send).toEqual({
      label: "Send",
      target: { to: "send" },
      disabled: true,
      reason: "Nothing to send yet.",
    });
    expect(view.receive).toEqual({
      label: "Receive",
      target: { to: "receive" },
      disabled: false,
      reason: null,
    });
    expect(view.addMoney).toEqual({
      label: "Add money",
      target: { to: "addMoney" },
      disabled: false,
      reason: null,
    });
    expect(view.activity).toEqual([]);
  });

  it("shows one balance over its USDC and SOL, its four actions and what it did, newest first", () => {
    const entries = [
      activity({ id: "in", portfolioId: "funding", kind: "deposit", at: 1_000 }),
      activity({ id: "moved", portfolioId: "acc_1", kind: "fund", amount: 60, usd: 60, at: 2_000 }),
      activity({ id: "out", portfolioId: "funding", kind: "send", amount: 15, usd: 15, at: 3_000 }),
      activity({ id: "buy", portfolioId: "acc_1", kind: "buy", symbol: "NVDAx", at: 4_000 }),
    ];
    const view = page(holding(25, 0.5, entries));
    expect(view.total).toEqual({ label: "Balance", value: "$125.00" });
    // A tracker that sits at its address is not listed and not counted.
    expect(view.assets).toEqual([
      { symbol: "USDC", amount: "25.00 USDC", value: "$25.00" },
      { symbol: "SOL", amount: "0.5000 SOL", value: "$100.00" },
    ]);
    expect(view).toMatchObject({ empty: null, loading: false, unavailable: null, stale: null });
    const actions = [view.move, view.send, view.receive, view.addMoney];
    expect(actions.map((action) => action.disabled)).toEqual([false, false, false, false]);
    expect(view.activity.map((row) => [row.id, row.title, row.value.text])).toEqual([
      ["out", "Sent", "-$15.00"],
      ["moved", "Moved to portfolio", "-$60.00"],
      ["in", "Money arrived", "+$100.00"],
    ]);
  });

  it("can send SOL it holds while there is no USDC to move", () => {
    const view = page(holding(0, 0.5));
    expect(view.empty).toBeNull();
    expect(view.move.disabled).toBe(true);
    expect(view.send).toMatchObject({ disabled: false, reason: null });
  });

  it("draws no total and no SOL value while SOL has no live price, and never a part of the sum", () => {
    const view = page(holding(25, 0.5), {}, TEST_PRICES);
    expect(view.total.value).toBeNull();
    expect(view.assets).toEqual([
      { symbol: "USDC", amount: "25.00 USDC", value: "$25.00" },
      { symbol: "SOL", amount: "0.5000 SOL", value: null },
    ]);
    // With USDC alone nothing needs a price.
    expect(page(holding(25), {}, TEST_PRICES).total.value).toBe("$25.00");
  });

  it("keeps the last figures, with the notice, when a later refresh fails", () => {
    const failed = recordRead(READ, false, UPDATED_AT + 1_000);
    const view = page(holding(25), { now: UPDATED_AT + 1_000, balances: failed });
    expect(view.total.value).toBe("$25.00");
    expect(view.stale).toBe("We couldn't update your balances. What you see may be out of date.");
    expect(view.unavailable).toBeNull();
    expect(view.move.disabled).toBe(false);
  });
});

describe("fundingOutcomeView", () => {
  const base = { asset: "USDC", amount: 10, arrived: 10, fee: 0.21, portfolioLabel: "Investing" };

  it("says the funds arrived, with the fees charged on a private transfer", () => {
    expect(fundingOutcomeView({ ...base, outcome: "done", privateRoute: true })).toEqual({
      title: "Funds arrived",
      body: "10.00 USDC is now in Investing, read back from its real balance. 0.21 USDC in fees was charged on top.",
      observerLink: "See what an outside observer can and cannot connect.",
      close: "Done",
      alert: false,
      tone: "success",
    });
    expect(fundingOutcomeView({ ...base, outcome: "done", privateRoute: false })).toMatchObject({
      body: "10.00 USDC is now in Investing, read back from its real balance.",
      observerLink: null,
    });
  });

  it("does not offer to send again when the outcome is unknown or still settling", () => {
    const unknown = fundingOutcomeView({ ...base, outcome: "unknown", privateRoute: true });
    expect(unknown).toMatchObject({
      title: "Sent, but not confirmed",
      close: "Close",
      alert: true,
    });
    expect(unknown.body).toBe(
      "The transfer of 10.00 USDC was sent, but we could not confirm that it arrived. It may still arrive. Do not send it again yet: check your main wallet’s USDC balance first. If it has gone down, the money is on its way to Investing and needs nothing more from you.",
    );
    expect(fundingOutcomeView({ ...base, outcome: "pending", privateRoute: true })).toMatchObject({
      title: "Still settling",
      close: "Close",
      alert: false,
    });
  });
});
