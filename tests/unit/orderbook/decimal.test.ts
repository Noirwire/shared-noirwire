import { describe, expect, it } from "vitest";
import {
  divFixedPoint,
  fromFixedPoint,
  mulFixedPoint,
  parseNumberUnits,
  parseUnits,
  readFixedPoint,
  toFixedPoint,
} from "../../../src/domain/orderbook/decimal.js";

function fromFixedPointUnits(raw: bigint, decimals: number): string {
  const digits = raw.toString().padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

describe("fixed-point decimals", () => {
  it("round-trips a plain decimal", () => {
    expect(fromFixedPoint(toFixedPoint("150.25"), 2)).toBe("150.25");
  });

  it("round-trips a negative decimal", () => {
    expect(fromFixedPoint(toFixedPoint("-12.5"), 2)).toBe("-12.50");
  });

  it("refuses text that is not a decimal", () => {
    expect(() => toFixedPoint("abc")).toThrow();
    expect(() => toFixedPoint("1e3")).toThrow();
    expect(readFixedPoint("1,5")).toBeNull();
  });

  it("refuses a nonzero digit past the ninth decimal rather than dropping it", () => {
    expect(() => toFixedPoint("1.0000000001")).toThrow();
    expect(readFixedPoint("1.0000000001")).toBeNull();
  });

  it("reads zeros past the ninth decimal, which lose nothing", () => {
    expect(toFixedPoint("9.900000000000")).toBe(9_900_000_000n);
  });

  it("writes a value back cut toward zero, never rounded up", () => {
    expect(fromFixedPoint(toFixedPoint("1.999"), 2)).toBe("1.99");
    expect(fromFixedPoint(toFixedPoint("-1.999"), 2)).toBe("-1.99");
  });

  it("reads an amount into exact base units", () => {
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("12", 9)).toBe(12_000_000_000n);
    expect(parseUnits("9007199254.740993", 6)).toBe(9_007_199_254_740_993n);
    expect(parseUnits("1.500000000", 6)).toBe(1_500_000n);
  });

  it("refuses too many decimals, signs, exponents and non-numbers", () => {
    expect(() => parseUnits("0.0000001", 6)).toThrow("More than 6 decimals");
    for (const bad of ["-1", "1e3", "1e-7", "NaN", "Infinity", "", ".5", "1.", "1,5", "0x10"]) {
      expect(() => parseUnits(bad, 6)).toThrow();
    }
  });

  it("reads a number as its plain decimal, without float noise or exponent form", () => {
    expect(parseNumberUnits(0.1 + 0.2, 6)).toBe(300_000n);
    expect(parseNumberUnits(1e-7, 9)).toBe(100n);
    expect(parseNumberUnits(1.5e-7, 9)).toBe(150n);
    expect(parseNumberUnits(0, 6)).toBe(0n);
    expect(() => parseNumberUnits(1e-7, 6)).toThrow();
    expect(() => parseNumberUnits(1e21, 6)).toThrow();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
      expect(() => parseNumberUnits(bad, 6)).toThrow();
    }
  });

  it("round-trips decimal strings at 6 and 9 places", () => {
    for (const decimals of [6, 9]) {
      for (const raw of [1n, 999_999n, 1_000_000n, 123_456_789n, 9_007_199_254_740_991n]) {
        const text = fromFixedPointUnits(raw, decimals);
        expect(parseUnits(text, decimals)).toBe(raw);
      }
    }
  });

  it("multiplies two fixed-point values as integers", () => {
    expect(fromFixedPoint(mulFixedPoint(toFixedPoint("2"), toFixedPoint("150.5")), 2)).toBe(
      "301.00",
    );
  });

  it("divides two fixed-point values as integers", () => {
    expect(fromFixedPoint(divFixedPoint(toFixedPoint("1000"), toFixedPoint("5")), 2)).toBe(
      "200.00",
    );
    expect(() => divFixedPoint(1n, 0n)).toThrow();
  });
});
