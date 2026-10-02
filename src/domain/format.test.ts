import { describe, expect, it } from "vitest";
import {
  changeTone,
  deltaText,
  shares,
  shortAddress,
  sinceDate,
  symbolAmount,
  tokenAmount,
  usd,
} from "./format.js";

describe("shortAddress", () => {
  it("keeps the lead and tail characters, collapsing the middle", () => {
    expect(shortAddress("5aqYNsJsmRuasaFMMWAF2s94r1bTuXZC46A6Ro9C82GY")).toBe("5aqY...82GY");
  });

  it("respects custom lead/tail lengths", () => {
    expect(shortAddress("abcdefghij", 2, 3)).toBe("ab...hij");
  });
});

describe("usd", () => {
  it("formats a positive amount as USD with two decimals", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
  });

  it("formats zero and negative amounts", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(-42)).toBe("-$42.00");
  });
});

describe("shares", () => {
  it("formats with four decimal places", () => {
    expect(shares(1.5)).toBe("1.5000");
    expect(shares(0)).toBe("0.0000");
  });
});

describe("tokenAmount", () => {
  it("formats a real SPL token amount with two decimals and no dollar sign", () => {
    expect(tokenAmount(500)).toBe("500.00");
    expect(tokenAmount(0)).toBe("0.00");
    expect(tokenAmount(1234.5)).toBe("1,234.50");
  });
});

describe("symbolAmount", () => {
  it("shows USDC with two decimals and everything else with four", () => {
    expect(symbolAmount("USDC", 10)).toBe("10.00 USDC");
    expect(symbolAmount("SOL", 1.5)).toBe("1.5000 SOL");
    expect(symbolAmount("SPYx", 5)).toBe("5.0000 SPYx");
  });
});

describe("sinceDate", () => {
  it("formats a timestamp as day/short-month/year", () => {
    // Noon UTC stays "15 Jan 2026" in every timezone from UTC-12 to UTC+12,
    // so this doesn't depend on the machine running the test.
    expect(sinceDate(Date.UTC(2026, 0, 15, 12))).toBe("15 Jan 2026");
  });
});

describe("deltaText", () => {
  it("signs a percentage alone, to two decimals", () => {
    expect(deltaText(2.345)).toBe("+2.35%");
    expect(deltaText(-1.2)).toBe("-1.20%");
  });

  it("pairs a dollar gain with its percentage, signed by the gain", () => {
    expect(deltaText(4.26, 52.1)).toBe("+$52.10 (4.3%)");
    expect(deltaText(-4.26, -52.1)).toBe("-$52.10 (4.3%)");
  });

  it("gives a change of exactly zero no sign", () => {
    expect(deltaText(0)).toBe("0.00%");
    expect(deltaText(-0)).toBe("0.00%");
    expect(deltaText(0, 0)).toBe("$0.00 (0.0%)");
  });
});

describe("changeTone", () => {
  it("is safe above zero and danger below", () => {
    expect(changeTone(3)).toBe("safe");
    expect(changeTone(-0.01)).toBe("danger");
  });

  it("is neutral at exactly zero, never negative", () => {
    expect(changeTone(0)).toBe("neutral");
    expect(changeTone(-0)).toBe("neutral");
  });
});
