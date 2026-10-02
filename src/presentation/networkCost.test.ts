import { describe, expect, it } from "vitest";
import { networkCostView } from "./networkCost.js";

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
});
