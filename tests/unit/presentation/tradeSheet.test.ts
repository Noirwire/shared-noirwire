import { describe, expect, it } from "vitest";
import type { PricedOrder } from "../../../src/domain/order.js";
import {
  amountFloor,
  portfolioChoices,
  tradeOutcome,
  tradeProgressSteps,
  tradeReviewView,
  type TradeReviewState,
} from "../../../src/presentation/trade.js";
import { holding, testReads, testWallet, withFirst, withHolding } from "../support/screens.js";

const reads = testReads();

const order = (overrides: Partial<PricedOrder> = {}): PricedOrder => ({
  side: "buy",
  spend: 50,
  receive: 2,
  receiveAtLeast: 1.9,
  unitPrice: 25,
  venue: "Jupiter",
  priceChecked: true,
  quote: { feeBps: 25, gasless: false, expiresAt: 30_000 },
  ...overrides,
});

const review = (overrides: Partial<TradeReviewState> = {}) =>
  tradeReviewView({
    order: order(),
    symbol: "NVDAx",
    unitsPerHeld: 1,
    portfolioLabel: "Investing",
    cost: { kind: "relayer", fee: 0.05, feeRaw: 50_000n, opens: null, count: 1 },
    lamports: 0,
    built: true,
    noirwireFeeBps: 0,
    now: 0,
    pending: { blocked: false },
    submitting: false,
    covering: false,
    platform: "mobile",
    ...overrides,
  });

describe("tradeReviewView on the phone", () => {
  it("leads with what leaves and the least that comes back, and adds the relayer's fee to the total", () => {
    const view = review();
    expect(view.headline).toEqual(["Spend $50.00 from Investing", "Receive at least 1.9000 NVDAx"]);
    expect(view.countdown).toBe("Price held for 30 seconds.");
    expect(view.total).toEqual({ label: "Total cost", value: "50.05 USDC" });
    expect(view.trackerLine).toBe(
      "NVDAx is a tracker, not a share, and its issuer keeps control over it.",
    );
    expect(view.action).toEqual({ kind: "confirm", label: "Confirm buy", disabled: false });
  });

  it("says a sale's total after the fee, and a paid cost as already paid", () => {
    const view = review({
      order: order({ side: "sell", spend: 2, receive: 50, receiveAtLeast: 49 }),
      costPaid: true,
    });
    expect(view.headline).toEqual(["Sell 2.0000 NVDAx from Investing", "Receive at least $49.00"]);
    expect(view.total).toEqual({ label: "Total you receive, at least", value: "49.00 USDC" });
    expect(view.terms.find((term) => term.label === "Network cost")?.value).toBe("Already paid");
    expect(view.reasons).toEqual([
      "The holding is open. The network cost for that is already paid.",
    ]);
    expect(view.trackerLine).toBeNull();
  });

  it("calls a covered cost included in the fee on the phone, and keeps the web's word", () => {
    const covered = { cost: { kind: "covered" } as const };
    expect(review(covered).terms.find((t) => t.label === "Network cost")?.value).toBe(
      "Included in the fee",
    );
    expect(
      review({ ...covered, platform: undefined }).terms.find((t) => t.label === "Network cost")
        ?.value,
    ).toBe("Covered");
  });

  it("holds Confirm back offline, while a new price settles, and while the relayer is down", () => {
    expect(review({ online: false })).toMatchObject({
      action: { disabled: true },
      offline: "You're offline. Nothing can be confirmed until you're back online.",
    });
    expect(review({ settling: true }).action).toMatchObject({ disabled: true });
    expect(review({ relayerDown: true }).action).toMatchObject({ disabled: true });
  });

  it("counts an expired price down to the end, and asks for a new one", () => {
    const view = review({ now: 31_000 });
    expect(view.countdown).toBe("This price expired. Get a new price to continue.");
    expect(view.action).toEqual({ kind: "newPrice", label: "Get a new price" });
  });
});

describe("portfolioChoices", () => {
  it("offers every active portfolio to buy, and only holders to sell", () => {
    const wallet = withFirst((p) =>
      withHolding(withHolding(p, holding("USDC", 12)), holding("NVDAx", 2)),
    );
    expect(portfolioChoices(reads, wallet, "buy", null)).toMatchObject([
      { id: "acc_1", caption: "12.00 USDC available" },
    ]);
    expect(portfolioChoices(reads, wallet, "sell", "NVDAx")).toMatchObject([
      { id: "acc_1", caption: "2.0000 NVDAx held" },
    ]);
    expect(portfolioChoices(reads, testWallet(), "sell", "NVDAx")).toEqual([]);
  });
});

describe("amountFloor", () => {
  it("names the smallest order, and holds back an amount below it", () => {
    expect(amountFloor({ dollars: 5, valid: true, smallest: 10 })).toEqual({
      caption: "The smallest order is about 10 USDC. Your order price is shown at review.",
      below: "The smallest order is about 10 USDC.",
    });
    expect(amountFloor({ dollars: 20, valid: true, smallest: 10 }).below).toBeNull();
  });
});

describe("tradeProgressSteps", () => {
  it("opens the holding first on a first buy, and only places and reads otherwise", () => {
    expect(tradeProgressSteps({ firstBuy: false, symbol: "NVDAx", phase: "acting" })).toEqual([
      { key: "placing", title: "Placing the order", status: "current" },
      { key: "reading", title: "Reading the new balance", status: "waiting" },
    ]);
    const opened = tradeProgressSteps({ firstBuy: true, symbol: "NVDAx", phase: "acting" });
    expect(opened[0]).toMatchObject({ status: "done", caption: expect.stringMatching(/open/) });
    expect(opened[1].status).toBe("current");
  });
});

describe("tradeOutcome", () => {
  const context = {
    side: "buy" as const,
    symbol: "NVDAx",
    portfolioLabel: "Investing",
    reviewed: order(),
    unitsPerHeld: 1,
    platform: "mobile" as const,
  };

  it("says what was bought, or that it was placed but not read", () => {
    expect(tradeOutcome({ kind: "confirmed", settlement: "balancesRead" }, context)).toMatchObject({
      kind: "result",
      view: { tone: "success", headline: "Bought 2.0000 NVDAx" },
    });
    expect(
      tradeOutcome({ kind: "confirmed", settlement: "balancesEstimated" }, context),
    ).toMatchObject({ view: { headline: "Order placed" } });
  });

  it("warns on an unknown outcome, and offers a new price once the holding is paid for", () => {
    expect(tradeOutcome({ kind: "unknown", completed: [] }, context)).toMatchObject({
      view: { tone: "warning", headline: "Sent, but not confirmed" },
    });
    expect(
      tradeOutcome(
        {
          kind: "failed",
          reason: "orderNotPlaced",
          completed: [{ step: "accountOpened", opens: "holding" }],
        },
        context,
      ),
    ).toMatchObject({ view: { tone: "error", newPrice: "Review a new price" } });
  });

  it("goes back to the review when the price, the cost or the relayer changed", () => {
    expect(
      tradeOutcome(
        {
          kind: "needsReview",
          change: { because: "priceMoved", replacement: order() },
          completed: [],
        },
        context,
      ),
    ).toMatchObject({ kind: "review", notice: { tone: "warning" }, replacement: order() });
    expect(
      tradeOutcome(
        { kind: "needsReview", change: { because: "networkCostRose" }, completed: [] },
        context,
      ),
    ).toMatchObject({ reviewAgain: "relayer", costPaid: false });
    expect(
      tradeOutcome(
        { kind: "needsReview", change: { because: "relayerUnavailable" }, completed: [] },
        context,
      ),
    ).toMatchObject({ reviewAgain: "other", relayerDown: true });
  });

  it("says nothing was traded after a refusal, in the phone's words", () => {
    expect(
      tradeOutcome({ kind: "refused", reason: "notRecorded", completed: [] }, context),
    ).toMatchObject({
      kind: "review",
      notice: {
        tone: "danger",
        text: expect.stringMatching(
          /^This could not be saved on this phone, so nothing was sent\./,
        ),
      },
    });
    expect(
      tradeOutcome(
        { kind: "failed", reason: "tradeFailed", cause: "wrongNetwork", completed: [] },
        context,
      ),
    ).toMatchObject({
      notice: { text: expect.stringMatching(/not connected to Solana.*Nothing was signed/) },
    });
  });
});
