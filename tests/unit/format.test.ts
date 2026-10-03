import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeTone,
  deltaText,
  shares,
  shortAddress,
  sinceDate,
  tokenAmount,
  usd,
} from "../../src/domain/format.js";
import { shownAmount } from "../../src/wallet/amounts.js";

const livePrices = new Map<string, { usd: number; change24h: number }>();
const multipliers = new Map<string, number>();
vi.mock("../../src/infrastructure/prices/live.js", () => ({
  livePrice: (symbol: string) => livePrices.get(symbol),
}));
vi.mock("../../src/infrastructure/prices/multipliers.js", () => ({
  stockMultiplier: (symbol: string) => multipliers.get(symbol),
}));

afterEach(() => {
  livePrices.clear();
  multipliers.clear();
});

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

describe("shownAmount", () => {
  it("scales a stock's raw amount by its multiplier and appends the symbol, four decimals", () => {
    multipliers.set("SPYx", 1.25);
    expect(shownAmount("SPYx", 4)).toBe("5.0000 SPYx");
  });

  it("shows USDC and SOL unscaled, in their own decimal convention", () => {
    expect(shownAmount("USDC", 10)).toBe("10.00 USDC");
    expect(shownAmount("SOL", 1.5)).toBe("1.5000 SOL");
  });

  it("is Unavailable rather than the raw figure while a stock's multiplier is unknown", () => {
    expect(shownAmount("SPYx", 4)).toBe("Unavailable");
  });
});

describe("sinceDate", () => {
  it("formats a timestamp as day/short-month/year", () => {
    // Noon UTC stays "15 Jan 2026" in every timezone from UTC-12 to UTC+12,
    // so this doesn't depend on the machine running the test.
    const timestamp = Date.UTC(2026, 0, 15, 12);
    expect(sinceDate(timestamp)).toBe("15 Jan 2026");
  });
});

describe("deltaText", () => {
  it("signs a percentage alone", () => {
    expect(deltaText(2.345)).toBe("+2.35%");
    expect(deltaText(-1.2)).toBe("-1.20%");
  });

  it("signs a dollar gain with its percentage", () => {
    expect(deltaText(4.26, 52.1)).toBe("+$52.10 (4.3%)");
    expect(deltaText(-4.26, -52.1)).toBe("-$52.10 (4.3%)");
  });

  it("shows a change of exactly zero with no sign", () => {
    expect(deltaText(0)).toBe("0.00%");
    expect(deltaText(-0)).toBe("0.00%");
    expect(deltaText(0, 0)).toBe("$0.00 (0.0%)");
  });
});

describe("changeTone", () => {
  it("reads a gain as safe and a loss as danger", () => {
    expect(changeTone(3)).toBe("safe");
    expect(changeTone(-0.01)).toBe("danger");
  });

  it("reads exactly zero as neither", () => {
    expect(changeTone(0)).toBe("neutral");
    expect(changeTone(-0)).toBe("neutral");
  });
});
