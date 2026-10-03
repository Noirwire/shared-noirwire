import { describe, expect, it, vi } from "vitest";
import type { OrderTerms } from "../../src/domain/order.js";
import { noWorse, runLegs, type LegOutcome } from "../../src/application/actions/pieOrder.js";
import { legOutcomeView } from "../../src/presentation/pie.js";

function terms(
  overrides: Partial<OrderTerms> & { expiresAt?: number; feeBps?: number; gasless?: boolean } = {},
): OrderTerms {
  return {
    spend: overrides.spend ?? 10,
    receiveAtLeast: overrides.receiveAtLeast ?? 1,
    quote: {
      expiresAt: overrides.expiresAt,
      feeBps: overrides.feeBps ?? 50,
      gasless: overrides.gasless,
    },
  };
}

function deps(overrides: Partial<Parameters<typeof runLegs<OrderTerms, string>>[1]> = {}) {
  return {
    now: () => 1_000,
    requote: vi.fn(async () => ({ plan: terms() })),
    approve: vi.fn(async () => false),
    submit: vi.fn(async () => ({ ok: true as const })),
    onChange: vi.fn((outcomes: LegOutcome[]) => outcomes),
    ...overrides,
  };
}

describe("runLegs", () => {
  it("places every leg in order and reports each one done", async () => {
    const run = deps();
    const outcomes = await runLegs(
      [
        { symbol: "SPYx", plan: terms() },
        { symbol: "NVDAx", plan: terms() },
      ],
      run,
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["done", "done"]);
    expect(run.submit).toHaveBeenCalledTimes(2);
  });

  it("stops at the first failure and places nothing after it", async () => {
    const run = deps({
      submit: vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ error: "Not enough SOL." }),
    });
    const outcomes = await runLegs(
      ["SPYx", "NVDAx", "AAPLx"].map((symbol) => ({ symbol, plan: terms() })),
      run,
    );
    expect(outcomes).toEqual([
      { symbol: "SPYx", status: "done" },
      { symbol: "NVDAx", status: "failed", stop: { because: "refused", error: "Not enough SOL." } },
      { symbol: "AAPLx", status: "not placed" },
    ]);
    expect(run.submit).toHaveBeenCalledTimes(2);
  });

  it("stops after an order that landed but could not be read back", async () => {
    const run = deps({ submit: vi.fn(async () => ({ ok: true as const, unconfirmed: true })) });
    const outcomes = await runLegs(
      ["SPYx", "NVDAx"].map((symbol) => ({ symbol, plan: terms() })),
      run,
    );
    expect(outcomes[0]).toMatchObject({ status: "done", unread: true });
    expect(legOutcomeView(outcomes[0])).toEqual({ note: expect.stringMatching(/Stopped/) });
    expect(outcomes[1].status).toBe("not placed");
    expect(run.submit).toHaveBeenCalledOnce();
  });

  it("turns a thrown error into a failed order instead of hanging the run", async () => {
    const run = deps({ submit: vi.fn(async () => Promise.reject(new Error("RPC down"))) });
    const outcomes = await runLegs(
      ["SPYx", "NVDAx"].map((symbol) => ({ symbol, plan: terms() })),
      run,
    );
    expect(outcomes).toEqual([
      { symbol: "SPYx", status: "failed", stop: { because: "threw", detail: "RPC down" } },
      { symbol: "NVDAx", status: "not placed" },
    ]);
  });

  it("re-prices an expired leg and places it without asking when the new terms are no worse", async () => {
    const replacement = terms({ receiveAtLeast: 2, expiresAt: 5_000 });
    const run = deps({ requote: vi.fn(async () => ({ plan: replacement })) });
    await runLegs([{ symbol: "SPYx", plan: terms({ expiresAt: 500 }) }], run);
    expect(run.approve).not.toHaveBeenCalled();
    expect(run.submit).toHaveBeenCalledWith(replacement);
  });

  it("asks before placing a worse replacement, and stops when the answer is no", async () => {
    const run = deps({
      requote: vi.fn(async () => ({ plan: terms({ receiveAtLeast: 0.5, expiresAt: 5_000 }) })),
    });
    const outcomes = await runLegs([{ symbol: "SPYx", plan: terms({ expiresAt: 500 }) }], run);
    expect(run.approve).toHaveBeenCalledOnce();
    expect(run.submit).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ status: "failed", stop: { because: "notAccepted" } });
    expect(legOutcomeView(outcomes[0]).error).toBe("Stopped: the new price was not accepted.");
  });

  it("never offers a replacement whose fee is unknown", async () => {
    const run = deps({
      requote: vi.fn(async () => ({
        plan: { ...terms({ expiresAt: 5_000 }), quote: { expiresAt: 5_000 } },
      })),
      approve: vi.fn(async () => true),
    });
    const outcomes = await runLegs([{ symbol: "SPYx", plan: terms({ expiresAt: 500 }) }], run);
    expect(run.approve).not.toHaveBeenCalled();
    expect(run.submit).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ status: "failed", stop: { because: "feeUnknown" } });
    expect(legOutcomeView(outcomes[0]).error).toBe(
      "Stopped: the new price came without a fee that could be checked.",
    );
  });

  it("places a worse replacement once it is accepted", async () => {
    const worse = terms({ receiveAtLeast: 0.5, expiresAt: 5_000 });
    const run = deps({
      requote: vi.fn(async () => ({ plan: worse })),
      approve: vi.fn(async () => true),
    });
    await runLegs([{ symbol: "SPYx", plan: terms({ expiresAt: 500 }) }], run);
    expect(run.submit).toHaveBeenCalledWith(worse);
  });
});

describe("what a leg's outcome says", () => {
  it("shows the order's own answer, or the thrower's, or that it could not be placed", () => {
    const failed = (stop: LegOutcome["stop"]): LegOutcome => ({
      symbol: "SPYx",
      status: "failed",
      stop,
    });
    expect(legOutcomeView(failed({ because: "refused", error: "Not enough SOL." }))).toEqual({
      error: "Not enough SOL.",
    });
    expect(legOutcomeView(failed({ because: "threw", detail: "RPC down" }))).toEqual({
      error: "RPC down",
    });
    expect(legOutcomeView(failed({ because: "threw" }))).toEqual({
      error: "The order could not be placed.",
    });
    expect(legOutcomeView({ symbol: "SPYx", status: "done" })).toEqual({});
  });
});

describe("noWorse", () => {
  it("requires a known fee that is not higher", () => {
    expect(noWorse(terms({ feeBps: 60 }), terms({ feeBps: 50 }))).toBe(false);
    expect(noWorse({ ...terms(), quote: {} }, terms())).toBe(false);
    expect(noWorse(terms({ spend: 11 }), terms())).toBe(false);
    expect(noWorse(terms(), terms())).toBe(true);
  });

  it("treats losing a gasless route as worse, since the account then pays the network", () => {
    expect(noWorse(terms({ gasless: false }), terms({ gasless: true }))).toBe(false);
    expect(noWorse(terms({ gasless: true }), terms({ gasless: false }))).toBe(true);
  });
});
