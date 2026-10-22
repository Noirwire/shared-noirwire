import { describe, expect, it } from "vitest";
import {
  ageText,
  clockTime,
  durationText,
  eventTime,
  orderbookDecimal,
  quoteAmount,
} from "../../../src/domain/orderbook/format.js";

describe("orderbookDecimal", () => {
  it("groups thousands and pads to the given places", () => {
    expect(orderbookDecimal("1234.5", 2)).toBe("1,234.50");
    expect(orderbookDecimal("42.1", 4)).toBe("42.1000");
    expect(orderbookDecimal("1234", 0)).toBe("1,234");
  });

  it("writes every digit of a value a floating-point number would lose", () => {
    expect(orderbookDecimal("123456789012345678.123456789", 9)).toBe(
      "123,456,789,012,345,678.123456789",
    );
  });

  it("rounds half away from zero", () => {
    expect(orderbookDecimal("1.005", 2)).toBe("1.01");
    expect(orderbookDecimal("-1.005", 2)).toBe("-1.01");
    expect(orderbookDecimal("999.995", 2)).toBe("1,000.00");
    expect(orderbookDecimal("1.004", 2)).toBe("1.00");
  });

  it("writes a nonzero value below the last place as a bound, never as zero", () => {
    expect(orderbookDecimal("0.0004", 2)).toBe("<0.01");
    expect(orderbookDecimal("-0.0004", 2)).toBe(">-0.01");
  });

  it("writes zero as zero, without a sign", () => {
    expect(orderbookDecimal("0", 2)).toBe("0.00");
    expect(orderbookDecimal("-0.000", 2)).toBe("0.00");
  });

  it("reads nothing that is not a decimal", () => {
    expect(orderbookDecimal("not-a-number", 2)).toBeNull();
    expect(orderbookDecimal("NaN", 2)).toBeNull();
    expect(orderbookDecimal("1e3", 2)).toBeNull();
  });
});

describe("quoteAmount", () => {
  it("names the venue's own quote token, never a dollar sign", () => {
    expect(quoteAmount("5000", "nUSD")).toBe("5,000.00 nUSD");
    expect(quoteAmount("12.5", "USDC")).toBe("12.50 USDC");
  });

  it("writes the number alone while the token is not known", () => {
    expect(quoteAmount("5000", "")).toBe("5,000.00");
  });

  it("has nothing to write for a value that is not a decimal", () => {
    expect(quoteAmount("abc", "USDC")).toBeNull();
  });
});

describe("durationText", () => {
  it("uses milliseconds below a second and seconds from there", () => {
    expect(durationText(420)).toBe("420 ms");
    expect(durationText(910)).toBe("910 ms");
    expect(durationText(1000)).toBe("1.00 s");
    expect(durationText(1240)).toBe("1.24 s");
  });

  it("has nothing for a negative or unknown duration", () => {
    expect(durationText(-5)).toBeNull();
    expect(durationText(Number.NaN)).toBeNull();
  });
});

describe("clockTime and eventTime", () => {
  const today = new Date(2026, 0, 5, 12, 0, 0).getTime();

  it("pads hours, minutes, seconds and milliseconds", () => {
    expect(clockTime(new Date(2026, 0, 5, 3, 4, 5, 6).getTime())).toBe("03:04:05.006");
  });

  it("gives the clock time of an event from today", () => {
    expect(eventTime(new Date(2026, 0, 5, 9, 30, 0, 500).getTime(), today)).toBe("09:30:00.500");
  });

  it("gives the date of an event from an earlier day", () => {
    expect(eventTime(new Date(2026, 0, 1, 9, 30, 0, 500).getTime(), today)).toBe("2026-01-01");
  });
});

describe("ageText", () => {
  it("names the largest whole unit", () => {
    expect(ageText(400)).toBe("just now");
    expect(ageText(4_000)).toBe("4s");
    expect(ageText(120_000)).toBe("2m");
    expect(ageText(7_200_000)).toBe("2h");
    expect(ageText(172_800_000)).toBe("2d");
  });

  it("has nothing for a negative or unknown age", () => {
    expect(ageText(-1)).toBeNull();
    expect(ageText(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
