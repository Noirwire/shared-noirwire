import { describe, expect, it } from "vitest";
import type { NetworkCost } from "../../../src/domain/networkCost.js";
import { networkCostView, type NetworkCostState } from "../../../src/presentation/networkCost.js";

const relayer = (
  overrides: Partial<Extract<NetworkCost, { kind: "relayer" }>> = {},
): NetworkCost => ({
  kind: "relayer",
  fee: 0.031234,
  feeRaw: 31_234n,
  opens: null,
  count: 1,
  ...overrides,
});

const view = (cost: NetworkCost | null, overrides: Partial<NetworkCostState> = {}) =>
  networkCostView({ cost, pending: { blocked: false }, submitting: false, ...overrides });

describe("networkCostView", () => {
  it("is still checking, and cannot be confirmed, while the cost is unknown", () => {
    expect(view(null)).toEqual({
      label: "Network cost",
      value: "Checking...",
      tone: "neutral",
      explanation: [],
      moveMoney: null,
      details: null,
      confirmDisabled: true,
    });
  });

  it("says a covered cost is covered, with nothing more to say", () => {
    const shown = view({ kind: "covered" });
    expect(shown.value).toBe("Covered");
    expect(shown.explanation).toEqual([]);
    expect(shown.details).toBeNull();
    expect(shown.confirmDisabled).toBe(false);
  });

  it("states a cost paid from the portfolio's own SOL in dollars, or as under a cent", () => {
    expect(view({ kind: "ownSol", usd: 0.0123 }).value).toBe(
      "about 0.01 USD, paid from this portfolio's SOL balance",
    );
    expect(view({ kind: "ownSol", usd: 0.004 }).value).toBe(
      "less than 0.01 USD, paid from this portfolio's SOL balance",
    );
    expect(view({ kind: "ownSol", usd: 0.004 }).confirmDisabled).toBe(false);
  });

  it("shows the relayer's fee to the cent, and explains it behind a disclosure", () => {
    const shown = view(relayer());
    expect(shown.value).toBe("0.03 USDC");
    expect(shown.explanation).toEqual([]);
    expect(shown.details).toEqual({
      summary: "Network cost: 0.03 USDC. What is this?",
      body: "Every action has a small network cost. NoirWire's relayer pays it, and this portfolio pays the relayer back exactly 0.031234 USDC, from its USDC, in the same transaction. The cost moves with the market: if it has risen by the time you confirm, nothing is sent and you are shown the new cost first. A transaction paid this way shows publicly that this portfolio uses NoirWire. It does not show your funding wallet or your other portfolios.",
    });
    expect(shown.confirmDisabled).toBe(false);
  });

  it("never rounds a fee under a cent to nothing", () => {
    expect(view(relayer({ fee: 0.004 })).value).toBe("less than 0.01 USDC");
  });

  it("says when the cost includes opening an account, and whose", () => {
    expect(view(relayer({ opens: "recipient" })).explanation).toEqual([
      "The network cost includes opening the recipient's account for this token, a one-time cost.",
    ]);
    expect(view(relayer({ opens: "earn" })).explanation[0]).toContain("account for Earn");
    expect(view(relayer({ opens: "cash" })).explanation[0]).toContain("account for USDC");
  });

  it("explains a first buy, opened before the order, for one tracker or several", () => {
    const one = view(relayer({ opens: "holding" }));
    expect(one.explanation).toEqual([
      "The network cost includes opening this portfolio's account for this tracker, a one-time cost.",
    ]);
    expect(one.details?.body).toContain(
      "from its USDC. The account is opened first, then your order is priced and placed, with one confirmation.",
    );
    const several = view(relayer({ opens: "holding", count: 3 }));
    expect(several.explanation).toEqual([
      "The network cost includes opening this portfolio's accounts for 3 trackers, a one-time cost.",
    ]);
    expect(several.details?.body).toContain(
      "The accounts are opened first, then your orders are priced and placed, with one confirmation.",
    );
  });

  it("says a withdrawal pays out of what it returns", () => {
    expect(view(relayer(), { withdrawing: true }).details?.body).toContain(
      "exactly 0.031234 USDC, out of the USDC this withdrawal returns, in the same transaction.",
    );
  });

  it("asks for more cash, with the way to move it in, when the fee cannot be met", () => {
    const shown = view({ kind: "needsCash", cash: 0.04, free: 0.01 });
    expect(shown.value).toBe("Not available");
    expect(shown.tone).toBe("warning");
    expect(shown.moveMoney).toEqual({
      before:
        "This portfolio needs at least 0.04 USDC to pay the network cost, and would have 0.01 USDC to spare. ",
      link: "Move to portfolio",
      after: " or use a smaller amount.",
    });
    expect(shown.confirmDisabled).toBe(true);
    expect(view({ kind: "needsCash", cash: 0.004, free: 0 }).moveMoney?.before).toBe(
      "This portfolio needs less than 0.01 USDC to pay the network cost, and would have 0.00 USDC to spare. ",
    );
  });

  it("explains each way a cost cannot be met, and refuses to confirm", () => {
    expect(view({ kind: "tooSmall", smallest: 10 }).explanation).toEqual([
      "The smallest order right now is about 10.00 USDC.",
    ]);
    expect(view({ kind: "noPrice" }).explanation).toEqual([
      "No price is available for this right now. Try again in a moment.",
    ]);
    expect(view({ kind: "unavailable" }).explanation).toEqual([
      "This can't be done right now. Nothing was charged. Please try again in a few minutes.",
    ]);
    for (const kind of ["tooSmall", "noPrice", "unavailable"] as const) {
      const cost = (kind === "tooSmall" ? { kind, smallest: 10 } : { kind }) as NetworkCost;
      expect(view(cost).confirmDisabled).toBe(true);
      expect(view(cost).tone).toBe("warning");
    }
  });

  it("holds Confirm back while the last action is unsettled or this one is being sent", () => {
    expect(view({ kind: "covered" }, { pending: { blocked: true } }).confirmDisabled).toBe(true);
    expect(view({ kind: "covered" }, { submitting: true }).confirmDisabled).toBe(true);
  });
});
