import { describe, expect, it } from "vitest";
import {
  completedSteps,
  leavesPending,
  movedNothing,
  refused,
  type ActionResult,
  type CompletedStep,
} from "./result.js";

type TradeReview = { price: number };

const opened: CompletedStep = { step: "accountOpened", opens: "holding", signature: "open-sig" };

const RESULTS: Record<ActionResult<TradeReview>["kind"], ActionResult<TradeReview>> = {
  refused: refused("actionPending"),
  needsReview: {
    kind: "needsReview",
    change: { because: "priceMoved", replacement: { price: 101 } },
    completed: [],
  },
  submitted: { kind: "submitted", signature: "sig", lastValidBlockHeight: 100 },
  notLanded: { kind: "notLanded", completed: [] },
  confirmed: { kind: "confirmed", signature: "sig", settlement: "balancesRead" },
  unknown: { kind: "unknown", completed: [] },
};

describe("refused", () => {
  it("carries a reason code and no words", () => {
    expect(refused("costUnavailable")).toEqual({
      kind: "refused",
      reason: "costUnavailable",
      completed: [],
    });
  });

  it("carries the steps that already landed", () => {
    expect(refused("costUnavailable", [opened]).kind).toBe("refused");
    expect(completedSteps(refused("costUnavailable", [opened]))).toEqual([opened]);
  });
});

describe("leavesPending", () => {
  it("is true only for what was sent and not seen to land", () => {
    const pending = Object.values(RESULTS).filter(leavesPending);
    expect(pending.map((result) => result.kind)).toEqual(["submitted", "unknown"]);
  });
});

describe("movedNothing", () => {
  it("is true only when nothing was sent or nothing landed", () => {
    const harmless = Object.values(RESULTS).filter(movedNothing);
    expect(harmless.map((result) => result.kind)).toEqual(["refused", "needsReview", "notLanded"]);
  });

  it("is false once an earlier step landed and was paid for", () => {
    const later: ActionResult<TradeReview>[] = [
      {
        kind: "needsReview",
        change: { because: "priceMoved", replacement: { price: 99 } },
        completed: [opened],
      },
      { kind: "notLanded", completed: [opened] },
      refused("costUnavailable", [opened]),
    ];
    for (const result of later) expect(movedNothing(result)).toBe(false);
  });
});

describe("completedSteps", () => {
  it("is empty for results that carry none", () => {
    expect(completedSteps(RESULTS.confirmed)).toEqual([]);
    expect(completedSteps(RESULTS.submitted)).toEqual([]);
  });
});

describe("a confirmed action whose balances could not be read back", () => {
  it("says so in its settlement", () => {
    const result: ActionResult = {
      kind: "confirmed",
      signature: "sig",
      settlement: "balancesEstimated",
    };
    expect(result).toMatchObject({ settlement: "balancesEstimated" });
  });
});
