import { describe, expect, it } from "vitest";
import { fundingDraft, type FundingInput } from "../../../src/application/funding.js";
import {
  fundingAmountView,
  fundingFooter,
  fundingOutcomeView,
  fundingProgressView,
  fundingReviewView,
  fundingTitle,
  type FundingAmountState,
} from "../../../src/presentation/funding.js";

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
    expect(fundingTitle("USDC", true)).toBe("Fund portfolio privately");
    expect(fundingTitle("SOL", false)).toBe("Add SOL publicly");
    expect(fundingFooter(true)).toMatch(/^A private transfer breaks the onchain link/);
    expect(fundingFooter(false)).toBe("This is an ordinary, fully public onchain transfer.");
  });
});

describe("fundingAmountView", () => {
  it("offers the presets it can afford and states the private route's costs", () => {
    const view = amountView();
    expect(view.lead).toBe(
      "Move USDC into this portfolio without publishing a transfer between your funding wallet and it. Available 20.00 USDC.",
    );
    expect(view.noPrivateRoute).toBeNull();
    expect(view.presets).toEqual([
      { value: 10, label: "10.00 USDC", disabled: false },
      { value: 25, label: "25.00 USDC", disabled: true },
    ]);
    expect(view.otherAmount).toBe("Other amount in USDC");
    expect(view.next).toEqual({ label: "Continue", disabled: true });
    expect(view.costs).toBe(
      "Costs a 0.1% privacy fee plus a flat 0.20 USDC relay fee, both charged in USDC by the settlement service on top of the amount. The relay fee pays the network costs, so your funding wallet needs no SOL. The smallest transfer is 0.50 USDC, and it usually arrives within seconds.",
    );
    expect(view.empty).toBeNull();
  });

  it("warns that SOL goes as a public transfer", () => {
    const view = amountView(
      { asset: "SOL", privateRoute: false, fundingBalance: 1, presets: [0.05] },
      { privateRoute: false, decimals: 0, fundingBalance: 1 },
    );
    expect(view.lead).toBe("Move SOL into this portfolio. Available 1.0000 SOL.");
    expect(view.noPrivateRoute).toMatch(/^SOL has no private route\./);
    expect(view.presets).toEqual([{ value: 0.05, label: "0.0500 SOL", disabled: false }]);
    expect(view.costs).toBeNull();
  });

  it("says what is wrong with a typed amount", () => {
    expect(amountView({}, { amountText: "50" }).invalid).toBe(
      "Enter an amount greater than zero and within your available balance.",
    );
    expect(amountView({}, { amountText: "0.3" }).unaffordable).toBe(
      "A private transfer has to be at least 0.50 USDC.",
    );
    expect(amountView({}, { amountText: "19.9" }).unaffordable).toBe(
      "With fees this takes 20.12 USDC from your funding wallet, more than it holds. Enter a smaller amount.",
    );
    expect(amountView({}, { amountText: "10" }).next).toEqual({
      label: "Continue",
      disabled: false,
    });
    expect(amountView({ pending: { blocked: true } }, { amountText: "10" }).next.disabled).toBe(
      true,
    );
  });

  it("points an empty funding wallet to its deposit address", () => {
    expect(amountView({ fundingBalance: 0 }, { fundingBalance: 0 }).empty).toEqual({
      before: "Your USDC funding balance is empty. ",
      link: "Get your deposit address",
      after: " to add money first.",
    });
  });
});

describe("fundingReviewView", () => {
  it("lists everything that leaves the funding wallet, exactly", () => {
    const view = fundingReviewView({
      draft: draft(),
      asset: "USDC",
      amount: 10,
      portfolioLabel: "Investing",
      pending: { blocked: false },
    });
    expect(view.lead).toBe(
      "Review what leaves your funding wallet before moving money into Investing.",
    );
    expect(view.terms).toEqual([
      { label: "Arrives in Investing", value: "10.00 USDC" },
      { label: "Privacy fee (0.1%)", value: "0.01 USDC" },
      { label: "Relay fee", value: "0.20 USDC" },
    ]);
    expect(view.total).toEqual({ label: "Total leaving your funding wallet", value: "10.21 USDC" });
    expect(view.note).toBe(
      "No SOL is needed. If the transfer would take more than this total, it is not signed.",
    );
    expect(view.confirm).toEqual({ label: "Confirm", disabled: false });
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

describe("fundingOutcomeView", () => {
  const base = { asset: "USDC", amount: 10, arrived: 10, fee: 0.21, portfolioLabel: "Investing" };

  it("says the funds arrived, with the fees charged on a private transfer", () => {
    expect(fundingOutcomeView({ ...base, outcome: "done", privateRoute: true })).toEqual({
      title: "Funds arrived",
      body: "10.00 USDC is now in Investing, read back from its real onchain balance. 0.21 USDC in fees was charged on top.",
      observerLink: "See what an outside observer can and cannot connect.",
      close: "Done",
      alert: false,
      tone: "success",
    });
    expect(fundingOutcomeView({ ...base, outcome: "done", privateRoute: false })).toMatchObject({
      body: "10.00 USDC is now in Investing, read back from its real onchain balance.",
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
      "The transfer of 10.00 USDC was sent, but we could not confirm that it arrived. It may still arrive. Do not send it again yet: check your funding wallet’s USDC balance first. If it has gone down, the money is on its way to Investing and needs nothing more from you.",
    );
    expect(fundingOutcomeView({ ...base, outcome: "pending", privateRoute: true })).toMatchObject({
      title: "Still settling",
      close: "Close",
      alert: false,
    });
  });
});
