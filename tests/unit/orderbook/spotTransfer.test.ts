import { describe, expect, it } from "vitest";
import { needsSpotTransfer } from "../../../src/domain/orderbook/spotTransfer.js";

const base = {
  isPerp: false,
  side: "buy" as const,
  hasWallet: true,
  canTransfer: true,
  spotAvailable: 0,
  collateralAvailable: 100,
};

describe("needsSpotTransfer", () => {
  it("offers a move for a spot buy with an empty spot balance and funded collateral", () => {
    expect(needsSpotTransfer(base)).toBe(true);
  });

  it("offers none once the spot balance holds funds", () => {
    expect(needsSpotTransfer({ ...base, spotAvailable: 5 })).toBe(false);
  });

  it("offers none with nothing to move from", () => {
    expect(needsSpotTransfer({ ...base, collateralAvailable: 0 })).toBe(false);
    expect(needsSpotTransfer({ ...base, collateralAvailable: null })).toBe(false);
  });

  it("offers none for a perp order, a sell, no wallet or no way to move funds", () => {
    expect(needsSpotTransfer({ ...base, isPerp: true })).toBe(false);
    expect(needsSpotTransfer({ ...base, side: "sell" })).toBe(false);
    expect(needsSpotTransfer({ ...base, hasWallet: false })).toBe(false);
    expect(needsSpotTransfer({ ...base, canTransfer: false })).toBe(false);
  });
});
