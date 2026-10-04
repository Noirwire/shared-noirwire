import { describe, expect, it } from "vitest";
import { tradeDraft, type TradeInput } from "../../../src/application/trade.js";
import type { PricedOrder } from "../../../src/domain/order.js";
import {
  tradeFormView,
  tradeReviewView,
  type TradeFormState,
  type TradeReviewState,
} from "../../../src/presentation/trade.js";
import { READ } from "../support/screens.js";

const input = (overrides: Partial<TradeInput> = {}): TradeInput => ({
  side: "buy",
  denom: "cash",
  amountText: "50",
  cash: 100,
  heldRaw: 0,
  unitsPerHeld: 1,
  displayPrice: 25,
  ...overrides,
});

const form = (overrides: Partial<TradeFormState> = {}, draft: Partial<TradeInput> = {}) =>
  tradeFormView({
    draft: tradeDraft(input(draft)),
    side: "buy",
    denom: "cash",
    symbol: "NVDAx",
    cash: 100,
    displayLive: true,
    quoting: false,
    balances: READ,
    ...overrides,
  });

const order = (overrides: Partial<PricedOrder> = {}): PricedOrder => ({
  side: "buy",
  spend: 50,
  receive: 2,
  receiveAtLeast: 1.9,
  unitPrice: 25,
  venue: "Jupiter",
  priceChecked: true,
  quote: { feeBps: 25, gasless: false },
  ...overrides,
});

const review = (overrides: Partial<TradeReviewState> = {}) =>
  tradeReviewView({
    order: order(),
    symbol: "NVDAx",
    unitsPerHeld: 1,
    portfolioLabel: "Investing",
    cost: { kind: "covered" },
    lamports: 0,
    built: true,
    noirwireFeeBps: 0,
    now: 0,
    pending: { blocked: false },
    submitting: false,
    covering: false,
    ...overrides,
  });

describe("tradeDraft", () => {
  it("caps a buy by cash, in dollars or in tokens at the display price", () => {
    expect(tradeDraft(input())).toMatchObject({ cap: 100, units: 2, value: 50, overCap: false });
    expect(tradeDraft(input({ denom: "units", amountText: "5" }))).toMatchObject({
      cap: 4,
      overCap: true,
    });
    expect(tradeDraft(input({ denom: "units", displayPrice: 0 })).cap).toBe(0);
  });

  it("quotes all the cash for a buy of the most tokens it can afford", () => {
    expect(tradeDraft(input({ denom: "units", amountText: "4" })).amountToQuote).toBe(100);
    expect(tradeDraft(input()).amountToQuote).toBe(50);
  });

  it("sells the exact stored amount when the whole position is sold", () => {
    const sell = { side: "sell" as const, denom: "units" as const, heldRaw: 3, unitsPerHeld: 2 };
    expect(tradeDraft(input({ ...sell, amountText: "6" })).amountToQuote).toBe(3);
    expect(tradeDraft(input({ ...sell, amountText: "2" })).amountToQuote).toBe(1);
    expect(tradeDraft(input({ ...sell, denom: "cash", amountText: "1" })).cap).toBe(150);
  });

  it("treats an empty or non-positive amount as no amount", () => {
    expect(tradeDraft(input({ amountText: " " }))).toMatchObject({ valid: false, typed: 0 });
    expect(tradeDraft(input({ amountText: "0" })).valid).toBe(false);
  });
});

describe("tradeFormView", () => {
  it("labels a buy in dollars and estimates the tokens", () => {
    expect(form()).toMatchObject({
      portfolioLabel: "Buy in portfolio",
      amountLabel: "Spend $",
      maxLabel: "Max",
      estimate: "Estimate: 2.0000 NVDAx",
      available: "Available $100.00",
      estimateBasis: "Estimate uses a live display price. Your order price is shown at review.",
      overCap: null,
      balanceUnavailable: null,
      action: { kind: "review", label: "Review buy", disabled: false },
    });
  });

  it("labels a sale and estimates the dollars", () => {
    const sell = form(
      { side: "sell", denom: "units" },
      { side: "sell", denom: "units", heldRaw: 3, amountText: "1" },
    );
    expect(sell).toMatchObject({
      portfolioLabel: "Sell from portfolio",
      amountLabel: "NVDAx tokens",
      maxLabel: "Sell all",
      estimate: "Estimate: $25.00",
      available: "Available 3.0000 NVDAx",
      action: { kind: "review", label: "Review sell" },
    });
    expect(form({ side: "sell", denom: "cash" }).amountLabel).toBe("Receive about $");
  });

  it("offers only the denomination it can estimate without a live price", () => {
    expect(form({ displayLive: false }).denominations).toEqual([
      { denom: "cash", label: "Amount in dollars", disabled: false },
      { denom: "units", label: "NVDAx tokens", disabled: true },
    ]);
    expect(form({ displayLive: false, side: "sell" }).denominations[0].disabled).toBe(true);
    expect(form({ displayLive: false })).toMatchObject({
      estimate: "Estimate: at review",
      estimateBasis: "No live price to estimate with. Your order price is shown at review.",
    });
  });

  it("says when the amount is over what can be used", () => {
    expect(form({}, { amountText: "500" }).overCap).toBe("More than this portfolio has to invest.");
    expect(form({ side: "sell" }, { side: "sell", amountText: "500" }).overCap).toBe(
      "More than this portfolio holds.",
    );
  });

  it("leads to adding money when there is no cash to buy with", () => {
    expect(form({ cash: 0 }).action).toEqual({ kind: "addMoney", label: "Add money" });
  });

  it("holds the review back while quoting, or without a known balance", () => {
    expect(form({ quoting: true }).action).toEqual({
      kind: "review",
      label: "Getting a live price...",
      disabled: true,
    });
    const unknown = form({}, { unitsPerHeld: undefined });
    expect(unknown.action).toMatchObject({ disabled: true });
    expect(unknown.balanceUnavailable).toBe(
      "This token's balance cannot be shown right now. Try again in a moment.",
    );
  });
});

describe("tradeReviewView", () => {
  it("lists a buy's terms, in dollars and tokens", () => {
    const view = review();
    expect(view.lead).toBe(
      "Review this live quote before moving funds from Investing. USDC is shown as dollars.",
    );
    expect(view.terms).toEqual([
      { label: "You pay", value: "$50.00 USDC" },
      { label: "You expect to receive", value: "2.0000 NVDAx" },
      { label: "Price for this order", value: "$25.00 per NVDAx" },
      { label: "Fee", value: "0.25% total · about $0.13" },
      { label: "Network cost", value: "Covered" },
      { label: "Quoted by", value: "Jupiter" },
      { label: "Minimum you will receive", value: "1.9000 NVDAx" },
    ]);
    expect(view.trackers).toEqual(["NVDAx"]);
    expect(view.action).toEqual({ kind: "confirm", label: "Confirm buy", disabled: false });
  });

  it("lists a sale's terms the other way round, and names no tracker", () => {
    const view = review({
      order: order({ side: "sell", spend: 2, receive: 50, receiveAtLeast: 49 }),
    });
    expect(view.terms[0]).toEqual({ label: "You pay", value: "2.0000 NVDAx" });
    expect(view.terms[1]).toEqual({ label: "You expect to receive", value: "$50.00 USDC" });
    expect(view.terms.at(-1)).toEqual({ label: "Minimum you will receive", value: "$49.00 USDC" });
    expect(view.trackers).toBeNull();
    expect(view.action).toMatchObject({ label: "Confirm sell" });
  });

  it("shows NoirWire's share when it charges one, and a per-share price by the multiplier", () => {
    const view = review({ noirwireFeeBps: 20, unitsPerHeld: 2 });
    expect(view.terms).toContainEqual({ label: "Of which NoirWire", value: "0.20%" });
    expect(view.terms[2]).toEqual({ label: "Price for this order", value: "$12.50 per NVDAx" });
  });

  it("explains the fee by how the network cost is met", () => {
    const gasless = { quote: { feeBps: 25, gasless: true } };
    expect(review({ order: order(gasless) }).fees.body).toContain("also covers the network cost");
    expect(review({ order: order(gasless), lamports: 5000 }).fees.body).toContain(
      "Opening a holding for the first time",
    );
    expect(review().fees.body).toBe(
      "The fee above is already inside the quoted amounts. The network cost of this order is separate, shown above.",
    );
  });

  it("asks for a new price when the fee is unknown or the quote expired", () => {
    const unknownFee = review({ order: order({ quote: {} }) });
    expect(unknownFee.terms[3]).toEqual({ label: "Fee", value: "Unknown" });
    expect(unknownFee.fees.body).toBe(
      "The fee for this quote could not be verified. Get another price before confirming.",
    );
    expect(unknownFee.action).toEqual({ kind: "newPrice", label: "Get a new price" });
    const expiring = order({ quote: { feeBps: 25, expiresAt: 1_000 } });
    expect(review({ order: expiring, now: 500 }).action.kind).toBe("confirm");
    expect(review({ order: expiring, now: 500 }).expiry).toMatch(/^Quote expires at /);
    expect(review({ order: expiring, now: 1_000 }).action.kind).toBe("newPrice");
    expect(review({ order: expiring, now: 1_000 }).expiry).toBe(
      "This price expired. Get a new price to continue.",
    );
    expect(review().expiry).toBeNull();
  });

  it("says when the price was not checked and when there is no firm order yet", () => {
    expect(review({ order: order({ priceChecked: false }) }).priceUnchecked).toContain(
      "No live price was available to compare this quote against.",
    );
    expect(review().priceUnchecked).toBeNull();
    expect(review({ built: false }).notFirm).toContain(
      "This is a live price, not yet a firm order.",
    );
    expect(review().notFirm).toBeNull();
  });

  it("labels Confirm by what is happening, and holds it back when it cannot go", () => {
    expect(review({ covering: true, submitting: true }).action).toEqual({
      kind: "confirm",
      label: "Opening the account...",
      disabled: true,
    });
    expect(review({ submitting: true }).action).toMatchObject({ label: "Submitting order..." });
    expect(review({ pending: { blocked: true } }).action).toMatchObject({ disabled: true });
    expect(review({ cost: { kind: "noPrice" } }).action).toMatchObject({ disabled: true });
  });
});
