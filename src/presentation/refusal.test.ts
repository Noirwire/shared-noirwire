import { describe, expect, it } from "vitest";
import { refusalMessage } from "./refusal.js";

const NOT_NOW =
  "This can't be done right now. Nothing was charged. Please try again in a few minutes.";

describe("refusalMessage", () => {
  it("says an unsettled action blocks the next one", () => {
    expect(refusalMessage("actionPending")).toContain("was sent and is not confirmed yet");
  });

  it("says nothing was charged when the cost or the reservation could not be met", () => {
    expect(refusalMessage("costUnavailable")).toBe(NOT_NOW);
    expect(refusalMessage("notRecorded")).toBe(NOT_NOW);
  });
});
