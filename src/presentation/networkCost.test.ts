import { describe, expect, it } from "vitest";
import { NO_PENDING_ACTION, type PendingAction } from "../application/pending.js";
import { networkCostView as viewOf, type NetworkCostInput } from "./networkCost.js";

const networkCostView = (cost: NetworkCostInput) =>
  viewOf({ cost, pending: NO_PENDING_ACTION, submitting: false });

const NOT_NOW =
  "This can't be done right now. Nothing was charged. Please try again in a few minutes.";

describe("networkCostView", () => {
  it("says a cost the venue pays is covered", () => {
    expect(networkCostView({ kind: "covered" })).toEqual({
      label: "Network cost",
      value: "Covered",
      tone: "neutral",
      explanation: [],
      confirmDisabled: false,
    });
  });

  it("states a cost paid from the portfolio's own SOL in dollars", () => {
    expect(networkCostView({ kind: "ownSol", usd: 0.0312 }).value).toBe(
      "about 0.03 USD, paid from this portfolio's SOL balance",
    );
    expect(networkCostView({ kind: "ownSol", usd: 0.004 })).toMatchObject({
      value: "less than 0.01 USD, paid from this portfolio's SOL balance",
      tone: "neutral",
      confirmDisabled: false,
    });
  });

  it("shows the relayer's fee to the cent, with nothing to explain when no account is opened", () => {
    expect(networkCostView({ kind: "relayer", fee: 0.35, opens: null, count: 1 })).toEqual({
      label: "Network cost",
      value: "0.35 USDC",
      tone: "neutral",
      explanation: [],
      confirmDisabled: false,
    });
  });

  it("never rounds a fee under a cent down to nothing", () => {
    expect(networkCostView({ kind: "relayer", fee: 0.0004, opens: null, count: 1 }).value).toBe(
      "less than 0.01 USDC",
    );
  });

  it.each([
    ["recipient", "the recipient's account for this token"],
    ["earn", "this portfolio's account for Earn"],
    ["holding", "this portfolio's account for this tracker"],
    ["cash", "this portfolio's account for USDC"],
  ] as const)("explains a cost that opens an account: %s", (opens, account) => {
    expect(networkCostView({ kind: "relayer", fee: 0.42, opens, count: 1 }).explanation).toEqual([
      `The network cost includes opening ${account}, a one-time cost.`,
    ]);
  });

  it("explains a cost that opens several holdings at once", () => {
    expect(
      networkCostView({ kind: "relayer", fee: 1.2, opens: "holding", count: 3 }).explanation,
    ).toEqual([
      "The network cost includes opening this portfolio's accounts for 3 trackers, a one-time cost.",
    ]);
  });

  it("holds Confirm back when the portfolio's cash cannot pay the fee", () => {
    expect(networkCostView({ kind: "needsCash", cash: 0.4, free: 0.1 })).toEqual({
      label: "Network cost",
      value: "Not available",
      tone: "warning",
      explanation: [
        "This portfolio needs at least 0.40 USDC of cash to pay the network cost, and would have 0.10 USDC to spare. Move money into this portfolio or use a smaller amount.",
      ],
      confirmDisabled: true,
    });
  });

  it("does not say 'at least' of a fee under a cent", () => {
    expect(networkCostView({ kind: "needsCash", cash: 0.002, free: 0 }).explanation[0]).toContain(
      "needs less than 0.01 USDC of cash",
    );
  });

  it("names the smallest order when this one is too small", () => {
    expect(networkCostView({ kind: "tooSmall", smallest: 5 })).toMatchObject({
      value: "Not available",
      tone: "warning",
      explanation: ["The smallest order right now is about 5.00 USDC."],
      confirmDisabled: true,
    });
  });

  it("says so when there is no price", () => {
    expect(networkCostView({ kind: "noPrice" })).toMatchObject({
      value: "Not available",
      tone: "warning",
      explanation: ["No price is available for this right now. Try again in a moment."],
      confirmDisabled: true,
    });
  });

  it("says plainly that nothing was charged when the cost cannot be met", () => {
    expect(networkCostView({ kind: "unavailable" })).toEqual({
      label: "Network cost",
      value: "Not available",
      tone: "warning",
      explanation: [NOT_NOW],
      confirmDisabled: true,
    });
  });

  it("holds Confirm back while the cost is still being worked out", () => {
    expect(viewOf({ cost: null, pending: NO_PENDING_ACTION, submitting: false })).toEqual({
      label: "Network cost",
      value: "Checking...",
      tone: "neutral",
      explanation: [],
      confirmDisabled: true,
    });
  });

  it("holds Confirm back while the action is being submitted", () => {
    const view = viewOf({
      cost: { kind: "covered" },
      pending: NO_PENDING_ACTION,
      submitting: true,
    });
    expect(view).toMatchObject({ value: "Covered", tone: "neutral", confirmDisabled: true });
  });

  it.each<PendingAction>([
    { status: "reserved" },
    { status: "submitted", signature: "sig", lastValidBlockHeight: 10 },
    { status: "unknown" },
  ])("holds Confirm back and says why while the last action is $status", (pending) => {
    const view = viewOf({ cost: { kind: "covered" }, pending, submitting: false });
    expect(view.confirmDisabled).toBe(true);
    expect(view.tone).toBe("warning");
    expect(view.explanation).toEqual([
      expect.stringContaining("was sent and is not confirmed yet"),
    ]);
  });

  it.each<PendingAction>([{ status: "landed" }, { status: "expired" }])(
    "lets a settled action ($status) be followed by the next one",
    (pending) => {
      expect(
        viewOf({ cost: { kind: "covered" }, pending, submitting: false }).confirmDisabled,
      ).toBe(false);
    },
  );
});
