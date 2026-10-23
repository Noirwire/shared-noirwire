import { describe, expect, it } from "vitest";
import {
  MIN_TRANSFER_RAW,
  RELAY_FEE_RAW,
  maxPrivateTransfer,
  privacyFeeFor,
  privateTransferCosts,
} from "../../src/domain/privateTransfer.js";

describe("the most a balance can move privately", () => {
  it("leaves room for both fees, exactly", () => {
    const max = maxPrivateTransfer(10, 6);
    const raw = BigInt(Math.round(max * 1e6));
    expect(raw + privacyFeeFor(raw) + RELAY_FEE_RAW).toBeLessThanOrEqual(10_000_000n);
    const more = raw + 1n;
    expect(more + privacyFeeFor(more) + RELAY_FEE_RAW).toBeGreaterThan(10_000_000n);
  });

  it("is 0 under the smallest transfer, and for amounts that are not balances", () => {
    expect(maxPrivateTransfer(0.5, 6)).toBe(0);
    expect(maxPrivateTransfer(Number.NaN, 6)).toBe(0);
    expect(maxPrivateTransfer(-3, 6)).toBe(0);
    expect(maxPrivateTransfer(Number.POSITIVE_INFINITY, 6)).toBe(0);
  });
});

describe("what a private transfer costs", () => {
  it("sums in exact base units", () => {
    const costs = privateTransferCosts(0.1 + 0.2, 6);
    expect(costs.total).toBe(Number(300_000n + privacyFeeFor(300_000n) + RELAY_FEE_RAW) / 1e6);
    expect(costs.minimum).toBe(Number(MIN_TRANSFER_RAW) / 1e6);
  });

  it("previews nothing but the flat fee for an amount the token cannot hold", () => {
    for (const amount of [Number.NaN, -1, 0, 1.0000001]) {
      expect(privateTransferCosts(amount, 6).total).toBe(Number(RELAY_FEE_RAW) / 1e6);
    }
  });
});
