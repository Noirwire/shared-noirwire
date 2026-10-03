import { describe, expect, it } from "vitest";
import { earnDraft } from "../../src/application/earn.js";
import { fundingDraft } from "../../src/application/funding.js";
import { decimalAmount, typedAmount } from "../../src/domain/amount.js";

describe("decimalAmount", () => {
  it("reads a period or a comma as the decimal separator", () => {
    expect(decimalAmount("12.5")).toBe(12.5);
    expect(decimalAmount("12,5")).toBe(12.5);
    expect(decimalAmount("0,25")).toBe(0.25);
    expect(decimalAmount(" 40 ")).toBe(40);
    expect(decimalAmount("1234")).toBe(1234);
  });

  it("reads an amount still being typed", () => {
    expect(decimalAmount("5.")).toBe(5);
    expect(decimalAmount("5,")).toBe(5);
    expect(decimalAmount(".5")).toBe(0.5);
    expect(decimalAmount(",5")).toBe(0.5);
    expect(decimalAmount("0")).toBe(0);
  });

  it("reads a comma that cannot be grouping", () => {
    expect(decimalAmount("0,234")).toBe(0.234);
    expect(decimalAmount("1,23")).toBe(1.23);
    expect(decimalAmount("1,2345")).toBe(1.2345);
    expect(decimalAmount("1234,567")).toBe(1234.567);
    expect(decimalAmount("1.234")).toBe(1.234);
  });

  it("refuses what could be read two ways", () => {
    expect(decimalAmount("1,234")).toBeNull();
    expect(decimalAmount("12,345")).toBeNull();
    expect(decimalAmount("999,000")).toBeNull();
    expect(decimalAmount("1,234.50")).toBeNull();
    expect(decimalAmount("1.234,50")).toBeNull();
    expect(decimalAmount("1,234,5")).toBeNull();
    expect(decimalAmount("1.2.3")).toBeNull();
  });

  it("refuses anything that is not a plain amount", () => {
    for (const text of ["", " ", ".", ",", "-1", "+1", "1e3", "0x10", "1 000", "Infinity", "abc"]) {
      expect(decimalAmount(text)).toBeNull();
    }
  });
});

describe("typedAmount", () => {
  it("is the amount, or 0 when nothing above zero was typed", () => {
    expect(typedAmount("0,25")).toBe(0.25);
    expect(typedAmount("12.5")).toBe(12.5);
    expect(typedAmount("0")).toBe(0);
    expect(typedAmount("1,234.50")).toBe(0);
    expect(typedAmount("1e3")).toBe(0);
    expect(typedAmount("")).toBe(0);
  });
});

describe("every draft reads an amount the same way", () => {
  it("takes a comma in a funding amount and an Earn amount", () => {
    const funding = fundingDraft({
      privateRoute: false,
      decimals: 6,
      fundingBalance: 100,
      amountText: "12,5",
    });
    expect(funding).toMatchObject({ customAmount: 12.5, amountValid: true });
    expect(
      earnDraft({ action: "deposit", amountText: "7,25", cash: 50, deposited: 0, cost: null }),
    ).toMatchObject({ amount: 7.25, valid: true });
  });
});
