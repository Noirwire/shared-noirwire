import { describe, expect, it } from "vitest";
import {
  amountToQuoteAtoms,
  chainAtomsToPrice,
  lotsToSize,
  orderbookUnitsFromChain,
  orderbookUnitsFromLotSize,
  priceToChainAtoms,
  quoteAtomsToAmount,
  sizeToLots,
} from "../../../src/domain/orderbook/units.js";

describe("order book units", () => {
  const units = orderbookUnitsFromLotSize("0.1");

  it("reads a lot of 0.1 base units as ten lots to the unit", () => {
    expect(units).toEqual({ lotsPerUnit: 10n, sizePerLot: 100_000n });
  });

  it("agrees with the units the market's account gives", () => {
    expect(orderbookUnitsFromChain(100_000_000n, 9)).toEqual(units);
  });

  it("refuses a lot finer than six decimals or one that does not divide a unit", () => {
    expect(() => orderbookUnitsFromChain(1n, 9)).toThrow();
    expect(() => orderbookUnitsFromChain(3n, 1)).toThrow();
    expect(() => orderbookUnitsFromLotSize("0.3")).toThrow();
  });

  it("turns a size into whole lots and back", () => {
    expect(sizeToLots(units, "1.5")).toBe(15n);
    expect(lotsToSize(units, 15n)).toBe("1.500000");
    expect(() => sizeToLots(units, "1.55")).toThrow();
  });

  it("turns a price into quote atoms per lot and back", () => {
    expect(priceToChainAtoms(units, "150.25")).toBe(15_025_000n);
    expect(chainAtomsToPrice(units, 15_025_000n)).toBe("150.250000");
    expect(() => priceToChainAtoms(units, "0.0000001")).toThrow();
  });

  it("makes lots times price per lot the notional in quote atoms", () => {
    const notional = sizeToLots(units, "0.3") * priceToChainAtoms(units, "150.25");
    expect(notional).toBe(amountToQuoteAtoms("45.075"));
  });

  it("converts quote atoms at six decimals", () => {
    expect(quoteAtomsToAmount(12_500_000n, 2)).toBe("12.50");
    expect(amountToQuoteAtoms("12.5")).toBe(12_500_000n);
    expect(() => amountToQuoteAtoms("1.0000001")).toThrow();
  });
});
