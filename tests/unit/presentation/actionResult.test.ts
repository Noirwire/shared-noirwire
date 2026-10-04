import { describe, expect, it } from "vitest";
import {
  refused,
  refusedFor,
  type ActionResult,
  type RefusalReason,
} from "../../../src/application/result.js";
import { failureReason } from "../../../src/domain/usageEvents.js";
import {
  actionFailure,
  chainAnswer,
  failureAccount,
  failureMessage,
  refusalMessage,
} from "../../../src/presentation/actionResult.js";

/**
 * The words each result is told with are the words the actions answered with
 * before they returned results: screens and the end-to-end suite read them.
 */
describe("what a refused action says", () => {
  const said: [RefusalReason, string][] = [
    [
      "actionPending",
      "Your last action from this portfolio is not confirmed yet. Nothing more can be confirmed here until that is known.",
    ],
    ["notRecorded", "This could not be saved in this browser, so nothing was sent."],
    ["walletLocked", "This wallet is locked. Unlock it with your password to sign."],
    [
      "keyMismatch",
      "This wallet's recovery phrase does not match the address shown. Nothing was signed. Reload to unlock again.",
    ],
    ["portfolioInactive", "This portfolio is not active."],
    ["portfolioGone", "That portfolio no longer exists."],
    ["portfolioNotSaved", "The new portfolio could not be saved in this browser."],
    ["activePortfolioAmount", "Enter an amount for an active portfolio."],
    ["amountAboveZero", "Enter an amount greater than zero."],
    [
      "sendNotCompleted",
      "This send can't be made. Nothing was sent. Check the amount and the recipient's address.",
    ],
    ["moreThanOnchain", "More than this portfolio holds onchain."],
    ["tradingMainnetOnly", "Live trading runs on mainnet."],
    ["earnMainnetOnly", "Earning runs on Solana mainnet."],
  ];

  it.each(said)("%s", (reason, words) => {
    expect(refusalMessage(refused(reason))).toBe(words);
  });

  it("names the asset a refusal is about", () => {
    expect(refusalMessage(refusedFor("unknownAsset", "DOGE"))).toBe("Unknown asset: DOGE.");
    expect(refusalMessage(refusedFor("notPrivate", "SOL"))).toBe(
      "SOL cannot be moved privately. Use a supported token.",
    );
    expect(refusalMessage(refusedFor("notTransferable", "DOGE"))).toBe(
      "DOGE cannot be transferred.",
    );
    expect(refusalMessage(refusedFor("notTradable", "SOL"))).toBe("SOL is not a tradable asset.");
  });
});

describe("what a failed action says", () => {
  const failed = (detail: string, reason: "sendFailed" | "noPrice" | "orderNotPlaced") =>
    ({ kind: "failed", reason, detail, completed: [] }) as const;

  it.each([
    "fetch failed",
    "Failed to fetch",
    "Network request failed",
    "The operation timed out.",
    "429 Too Many Requests: slow down",
    "502 Bad Gateway",
    "Jupiter returned 500.",
    "The private payment service returned 403.",
  ])("never passes on how a request failed: %s", (detail) => {
    expect(failureMessage(failed(detail, "sendFailed"))).toBe(
      "We couldn't complete this send. Nothing was sent. Try again.",
    );
    expect(failureMessage(failed(detail, "noPrice"))).toBe(
      "We couldn't get a price for this trade. Nothing was traded. Try again.",
    );
  });

  it("still counts such a failure under its own account", () => {
    expect(failureAccount(failed("Jupiter returned 429.", "noPrice"))).toBe(
      "Jupiter returned 429.",
    );
    expect(failureReason(failureAccount(failed("Jupiter returned 429.", "noPrice")))).toBe(
      "rate_limited",
    );
    expect(failureReason(failureAccount(failed("fetch failed", "sendFailed")))).toBe("network");
  });

  it("says the cost is already paid whichever words it uses", () => {
    expect(failureMessage(failed("fetch failed", "orderNotPlaced"))).toBe(
      "The order was not placed. The network cost is already paid, so you can try again at no further cost.",
    );
    expect(failureMessage(failed("The swap did not go through.", "orderNotPlaced"))).toBe(
      "The swap did not go through. The network cost is already paid, so you can try again at no further cost.",
    );
  });

  it("is the refusal's own account, or what the action was doing", () => {
    expect(
      failureMessage({
        kind: "failed",
        reason: "sendFailed",
        detail: "Simulation refused.",
        completed: [],
      }),
    ).toBe("Simulation refused.");
    expect(failureMessage({ kind: "failed", reason: "sendFailed", completed: [] })).toBe(
      "We couldn't complete this send. Nothing was sent. Try again.",
    );
    expect(failureMessage({ kind: "failed", reason: "fundingFailed", completed: [] })).toBe(
      "We couldn't move this money. Nothing was moved. Try again.",
    );
    expect(failureMessage({ kind: "failed", reason: "noPrice", completed: [] })).toBe(
      "We couldn't get a price for this trade. Nothing was traded. Try again.",
    );
    expect(failureMessage({ kind: "failed", reason: "earnFailed", completed: [] })).toBe(
      "This did not go through. Nothing was moved. Try again.",
    );
  });

  it("says the network cost is paid for an order that failed after its account opened", () => {
    const failed = { kind: "failed", reason: "orderNotPlaced", completed: [] } as const;
    expect(failureMessage(failed)).toBe(
      "The order was not placed. The network cost is already paid, so you can try again at no further cost.",
    );
    // Counted by those words, which name the network.
    expect(failureReason(failureMessage(failed))).toBe("network");
  });

  it("counts a lock by its words, as before", () => {
    const locked = {
      kind: "failed",
      reason: "tradeFailed",
      cause: "walletLocked",
      completed: [],
    } as const;
    expect(failureReason(failureMessage(locked))).toBe("locked");
  });
});

describe("what a screen is handed back", () => {
  it("is done for a confirmed or submitted action", () => {
    expect(chainAnswer({ kind: "confirmed", settlement: "balancesRead" })).toEqual({ ok: true });
    expect(actionFailure({ kind: "submitted", signature: "s" })).toBeNull();
  });

  it("says an unknown outcome may still land", () => {
    expect(chainAnswer({ kind: "unknown", completed: [] })).toEqual({
      error:
        "This was sent but could not be confirmed. It may still land; check the portfolio's balance before retrying.",
    });
  });

  it("asks for the new cost when the relayer's fee rose, and another way when it could not be used", () => {
    const rose: ActionResult = {
      kind: "needsReview",
      change: { because: "networkCostRose" },
      completed: [],
    };
    expect(chainAnswer(rose)).toEqual({
      error:
        "The network cost rose before this could be sent. Nothing was sent. Review the new network cost.",
      reviewAgain: "relayer",
    });
    const unavailable: ActionResult = {
      kind: "needsReview",
      change: { because: "relayerUnavailable" },
      completed: [],
    };
    expect(chainAnswer(unavailable)).toEqual({
      error:
        "The network cost could not be covered in USDC right now. Nothing was sent. Review the network cost again.",
      reviewAgain: "other",
    });
  });

  it("shows a moved price with the new order, and says the cost is paid only when it is", () => {
    const moved = (completed: number): ActionResult<string> => ({
      kind: "needsReview",
      change: { because: "priceMoved", replacement: "new" },
      completed: completed ? [{ step: "accountOpened", opens: "holding" }] : [],
    });
    expect(chainAnswer(moved(0))).toEqual({
      error: "The price moved before this order could be placed. Nothing was traded.",
      replacement: "new",
    });
    expect(chainAnswer(moved(1))).toMatchObject({ costCovered: true, replacement: "new" });
  });
});
