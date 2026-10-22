import { describe, expect, it } from "vitest";
import {
  divFixedPoint,
  fromFixedPoint,
  mulFixedPoint,
  readFixedPoint,
  toFixedPoint,
} from "../../../src/domain/orderbook/decimal.js";

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
