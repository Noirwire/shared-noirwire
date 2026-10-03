import { describe, expect, it } from "vitest";
import {
  legTerms,
  pieApprovalView,
  pieInvestView,
  pieProgressHeadline,
  pieRebalanceView,
  pieReviewView,
  type PieOrder,
  type PieReviewState,
} from "../../../src/presentation/pie.js";

const shownUnits = (_symbol: string, held: number) => held;
const nameOf = (symbol: string) => `${symbol} Inc`;

const order = (overrides: Partial<PieOrder> = {}): PieOrder => ({
  symbol: "NVDAx",
  side: "buy",
  spend: 40,
  receive: 2,
  receiveAtLeast: 1.9,
  unitPrice: 20,
  venue: "Jupiter",
  priceChecked: true,
  quote: { feeBps: 50 },
  ...overrides,
});

const review = (overrides: Partial<PieReviewState> = {}) =>
  pieReviewView({
    mode: "invest",
    side: "buy",
    orders: [order(), order({ symbol: "SPYx", spend: 60, receive: 1, receiveAtLeast: 0.95 })],
    cost: { kind: "covered" },
    leftover: 0,
    noirwireFeeBps: 0,
    shownUnits,
    nameOf,
    pending: { blocked: false },
    ...overrides,
  });

describe("legTerms", () => {
  it("sums up a buy and a sale on one line", () => {
    expect(legTerms(order(), shownUnits)).toBe(
      "Pay $40.00 · expect 2.0000 NVDAx · at least 1.9000 NVDAx · fee 0.50%",
    );
    expect(
      legTerms(order({ side: "sell", spend: 2, receive: 40, receiveAtLeast: 39 }), shownUnits),
    ).toBe("Sell 2.0000 NVDAx · expect $40.00 · at least $39.00 · fee 0.50%");
    expect(legTerms(order({ quote: {} }), shownUnits)).toMatch(/· fee unknown$/);
    expect(legTerms(order(), () => undefined)).toBe(
      "Pay $40.00 · expect Unavailable · at least Unavailable · fee 0.50%",
    );
  });
});

describe("pieInvestView", () => {
  const preview = [{ symbol: "NVDAx", usd: 30 }];

  it("shows how an amount splits and lets it be reviewed", () => {
    expect(pieInvestView({ amount: 30, cash: 50, preview, priced: true, nameOf })).toEqual({
      label: "Invest $",
      available: "$50.00 cash available",
      overCash: null,
      split: {
        title: "How it splits, toward your targets",
        legs: [{ symbol: "NVDAx", name: "NVDAx Inc", amount: "$30.00" }],
      },
      waiting: null,
      review: { label: "Review orders", disabled: false },
    });
  });

  it("refuses more than the cash, and waits for prices", () => {
    const over = pieInvestView({ amount: 80, cash: 50, preview, priced: true, nameOf });
    expect(over.overCash).toBe("More than your available cash.");
    expect(over.split).toBeNull();
    expect(over.review.disabled).toBe(true);
    const unpriced = pieInvestView({ amount: 30, cash: 50, preview, priced: false, nameOf });
    expect(unpriced.waiting).toBe(
      "Waiting for live prices, so the split can account for what the pie already holds.",
    );
    expect(unpriced.review.disabled).toBe(true);
    expect(
      pieInvestView({ amount: 0, cash: 50, preview: [], priced: true, nameOf }).review,
    ).toEqual({ label: "Review orders", disabled: true });
  });
});

describe("pieRebalanceView", () => {
  it("lists the sells, or says there is nothing to sell", () => {
    const view = pieRebalanceView({ sells: [{ symbol: "NVDAx", usd: 12 }], priced: true, nameOf });
    expect(view.sells).toEqual([
      { symbol: "NVDAx", label: "Sell NVDAx Inc", amount: "about $12.00" },
    ]);
    expect(view.nothingToSell).toBeNull();
    expect(view.price).toEqual({ label: "Price the sells", disabled: false });
    const none = pieRebalanceView({ sells: [], priced: true, nameOf });
    expect(none.nothingToSell).toBe("Nothing is far enough above target to sell.");
    expect(none.price.disabled).toBe(true);
    expect(
      pieRebalanceView({ sells: [{ symbol: "A", usd: 5 }], priced: false, nameOf }).price.disabled,
    ).toBe(true);
  });
});

describe("pieReviewView", () => {
  it("totals a set of buys and their fees", () => {
    const view = review();
    expect(view.step).toBeNull();
    expect(view.orders).toEqual([
      {
        symbol: "NVDAx",
        name: "NVDAx Inc",
        amount: "$40.00",
        terms: "Pay $40.00 · expect 2.0000 NVDAx · at least 1.9000 NVDAx · fee 0.50%",
      },
      {
        symbol: "SPYx",
        name: "SPYx Inc",
        amount: "$60.00",
        terms: "Pay $60.00 · expect 1.0000 SPYx · at least 0.9500 SPYx · fee 0.50%",
      },
    ]);
    expect(view.totals).toEqual([
      { label: "Total you pay", value: "$100.00 USDC" },
      { label: "Fees, included above", value: "about $0.50 · 0.50%" },
    ]);
    expect(view.sequence).toBe(
      "Orders are placed one at a time. Each stops if it would deliver less than its minimum.",
    );
    expect(view.networkCostLine).toBe("Network cost: Covered");
    expect(view.trackers).toEqual(["NVDAx", "SPYx"]);
    expect(view.back).toEqual({ label: "Back", ends: false });
    expect(view.confirm).toEqual({ label: "Place 2 orders", disabled: false });
  });

  it("shows NoirWire's share and cash left over, and flags a costly small order", () => {
    const view = review({
      noirwireFeeBps: 20,
      leftover: 0.5,
      orders: [order({ quote: { feeBps: 150 } })],
    });
    expect(view.totals).toContainEqual({ label: "Of which NoirWire", value: "0.20%" });
    expect(view.totals).toContainEqual({
      label: "Stays as cash, too small to split",
      value: "$0.50",
    });
    expect(view.smallOrders).toContain("Small orders carry a larger fee share");
    expect(view.confirm.label).toBe("Place 1 order");
  });

  it("says how long prices are firm when they expire", () => {
    expect(
      review({ orders: [order({ quote: { feeBps: 50, expiresAt: 5_000 } })] }).sequence,
    ).toMatch(
      /minimum\. Prices are firm until .+\. One that expires before its turn is priced again/,
    );
  });

  it("walks a rebalance through its sells, then its buys, which can be kept as cash", () => {
    const sells = review({
      mode: "rebalance",
      side: "sell",
      orders: [order({ side: "sell", spend: 2, receive: 40, receiveAtLeast: 39 })],
    });
    expect(sells.step).toBe("Step 1 of 2: sell what is above target.");
    expect(sells.totals[0]).toEqual({ label: "You expect to receive", value: "$40.00 USDC" });
    expect(sells.orders[0].amount).toBe("2.0000 NVDAx");
    expect(sells.trackers).toBeNull();
    expect(sells.back).toEqual({ label: "Back", ends: false });
    const buys = review({ mode: "rebalance" });
    expect(buys.step).toBe("Step 2 of 2: invest what the sells returned.");
    expect(buys.back).toEqual({ label: "Keep as cash", ends: true });
  });

  it("will not place orders it cannot fully state or pay for", () => {
    const unknownFee = review({ orders: [order({ quote: {} })] });
    expect(unknownFee.feeUnverified).toBe(
      "A fee could not be verified. Go back and price the orders again.",
    );
    expect(unknownFee.confirm.disabled).toBe(true);
    const unknownQuantity = review({ shownUnits: () => undefined });
    expect(unknownQuantity.quantityUnknown).toBe(
      "A token quantity cannot be shown right now. Try again in a moment.",
    );
    expect(unknownQuantity.confirm.disabled).toBe(true);
    expect(review({ pending: { blocked: true } }).confirm.disabled).toBe(true);
    expect(review({ cost: { kind: "unavailable" } }).confirm.disabled).toBe(true);
    expect(review({ orders: [order({ priceChecked: false })] }).someUnchecked).toContain(
      "No live price was available to compare some of these quotes against.",
    );
  });
});

describe("pieProgressHeadline", () => {
  it("says what is happening, then how many orders were placed", () => {
    expect(pieProgressHeadline({ kind: "running", side: "buy", covering: true }, [])).toBe(
      "Opening the accounts...",
    );
    expect(pieProgressHeadline({ kind: "running", side: "sell" }, [])).toBe("Placing sells...");
    expect(pieProgressHeadline({ kind: "done" }, [])).toBe("No order was placed");
    const done = { status: "done" };
    expect(pieProgressHeadline({ kind: "done" }, [done, done])).toBe("All 2 orders placed");
    expect(pieProgressHeadline({ kind: "done" }, [done, { status: "failed" }])).toBe(
      "1 of 2 orders placed",
    );
  });
});

describe("pieApprovalView", () => {
  it("compares the reviewed price with the new one, and warns when the venue stops paying", () => {
    const view = pieApprovalView({
      symbol: "NVDAx",
      reviewed: order({ quote: { feeBps: 50, gasless: true } }),
      replacement: order({ spend: 41, quote: { feeBps: 50 } }),
      shownUnits,
      nameOf,
    });
    expect(view).toEqual({
      label: "New price",
      title: "The price for NVDAx Inc expired, and the new one is worse.",
      reviewed: "Reviewed: Pay $40.00 · expect 2.0000 NVDAx · at least 1.9000 NVDAx · fee 0.50%",
      now: "Now: Pay $41.00 · expect 2.0000 NVDAx · at least 1.9000 NVDAx · fee 0.50%",
      paysOwnCost:
        "With this price the portfolio pays the order's network cost itself. If it cannot, the order is refused before signing.",
      stop: "Stop here",
      accept: "Accept new price",
    });
    expect(
      pieApprovalView({ symbol: "A", reviewed: order(), replacement: order(), shownUnits, nameOf })
        .paysOwnCost,
    ).toBeNull();
  });
});
