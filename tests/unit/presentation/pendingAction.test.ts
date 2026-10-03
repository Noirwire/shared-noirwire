import { describe, expect, it } from "vitest";
import {
  pendingActionNote,
  pendingActionNoteView,
} from "../../../src/presentation/pendingAction.js";

describe("pendingActionNote", () => {
  it("says the last action is not confirmed yet, for a portfolio and for the funding wallet", () => {
    expect(pendingActionNote("portfolio", "a send of 5.00 USDC", "waiting")).toBe(
      "Your last action from this portfolio (a send of 5.00 USDC) is not confirmed yet. It may still go through, so nothing can be confirmed here until that is known. This is checked for you.",
    );
    expect(pendingActionNote("funding", "moving 5.00 USDC into Investing", "waiting")).toBe(
      "Your last move of money from the funding wallet (moving 5.00 USDC into Investing) is not confirmed yet. It may still go through, so nothing can be confirmed here until that is known. This is checked for you.",
    );
  });

  it("asks the user to check the balance when the chain cannot settle it", () => {
    expect(pendingActionNote("portfolio", "a sale of NVDAx", "unresolved")).toBe(
      "We could not confirm whether your last action from this portfolio (a sale of NVDAx) went through. Check this portfolio's balance; you can clear this once you have.",
    );
    expect(pendingActionNote("funding", "x", "unresolved")).toContain(
      "Check the funding wallet's balance;",
    );
  });

  it("says how it ended", () => {
    expect(pendingActionNote("portfolio", "a buy of NVDAx", "landed")).toBe(
      "Your last action from this portfolio (a buy of NVDAx) went through. Check the balance before doing it again.",
    );
    expect(pendingActionNote("portfolio", "a buy of NVDAx", "expired")).toBe(
      "Your last action from this portfolio (a buy of NVDAx) did not go through, and no longer can. It is safe to try again.",
    );
  });
});

describe("pendingActionNoteView", () => {
  it("shows nothing without a note", () => {
    expect(pendingActionNoteView({ note: null, clearable: true, confirming: false })).toBeNull();
  });

  it("offers no way to clear what the chain will settle", () => {
    expect(pendingActionNoteView({ note: "n", clearable: false, confirming: false })).toEqual({
      note: "n",
      clear: null,
    });
  });

  it("offers Clear, then asks once more before it does", () => {
    expect(pendingActionNoteView({ note: "n", clearable: true, confirming: false })?.clear).toEqual(
      { asking: false, label: "Clear" },
    );
    expect(pendingActionNoteView({ note: "n", clearable: true, confirming: true })?.clear).toEqual({
      asking: true,
      warning:
        "Clearing does not prove it failed: it may still have gone through. Check the balance first, and clear it only if the balance shows it did not.",
      confirm: "Yes, clear it",
      keep: "Keep it",
    });
  });
});
