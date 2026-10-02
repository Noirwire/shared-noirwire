import { describe, expect, it } from "vitest";
import { leavesPending, movedNothing, refused, type ActionResult } from "./result.js";

const RESULTS: Record<ActionResult["kind"], ActionResult> = {
  refused: refused("actionPending"),
  needsReview: { kind: "needsReview" },
  submitted: { kind: "submitted", signature: "sig", lastValidBlockHeight: 100 },
  confirmed: { kind: "confirmed", signature: "sig" },
  unknown: { kind: "unknown" },
};

describe("refused", () => {
  it("carries the reason and the message people are shown", () => {
    expect(refused("costUnavailable")).toEqual({
      kind: "refused",
      reason: "costUnavailable",
      message:
        "This can't be done right now. Nothing was charged. Please try again in a few minutes.",
    });
    expect(refused("actionPending")).toMatchObject({
      reason: "actionPending",
      message: expect.stringContaining("was sent and is not confirmed yet"),
    });
  });
});

describe("leavesPending", () => {
  it("is true only for what was sent and not seen to land", () => {
    const unsettled = Object.values(RESULTS).filter(leavesPending);
    expect(unsettled.map((result) => result.kind)).toEqual(["submitted", "unknown"]);
  });
});

describe("movedNothing", () => {
  it("is true only when nothing was sent", () => {
    const harmless = Object.values(RESULTS).filter(movedNothing);
    expect(harmless.map((result) => result.kind)).toEqual(["refused", "needsReview"]);
  });
});
