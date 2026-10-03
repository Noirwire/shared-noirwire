import { afterEach, describe, expect, it, vi } from "vitest";
import { logged } from "../../src/application/walletRecord.js";
import { catalog } from "../../src/wallet/market.js";
import { activityAmount } from "../../src/wallet/amounts.js";
import type { Wallet } from "../../src/domain/wallet.js";

const multipliers = new Map<string, number>();
vi.mock("../../src/infrastructure/prices/live.js", () => ({ livePrice: () => undefined }));
vi.mock("../../src/infrastructure/prices/multipliers.js", () => ({
  stockMultiplier: (symbol: string) => multipliers.get(symbol),
}));

afterEach(() => multipliers.clear());

const WALLET = { activity: [] } as unknown as Wallet;
const entry = (symbol: string, amount: number) =>
  logged(WALLET, { portfolioId: "a", kind: "buy", symbol, amount, usd: 10 }, catalog).activity[0];

describe("what the activity log keeps of a stock trade", () => {
  it("records the amount as shown that day next to the raw amount", () => {
    multipliers.set("SPYx", 1.25);
    expect(entry("SPYx", 4)).toMatchObject({ amount: 4, shown: 5 });
  });

  it("keeps reading the same after a split changes the multiplier", () => {
    multipliers.set("SPYx", 1.25);
    const bought = entry("SPYx", 4);
    multipliers.set("SPYx", 5);
    expect(activityAmount(bought)).toBe("5.0000 SPYx");
  });

  it("records no shown amount when the multiplier is unknown, or for cash", () => {
    expect(entry("SPYx", 4)).not.toHaveProperty("shown");
    expect(entry("USDC", 4)).not.toHaveProperty("shown");
  });
});

describe("how an activity amount reads", () => {
  it("marks a stock entry from before shown amounts were recorded as raw tokens", () => {
    expect(activityAmount({ symbol: "SPYx", amount: 4 })).toBe("4.0000 SPYx (raw tokens)");
  });

  it("shows cash and SOL as they are", () => {
    expect(activityAmount({ symbol: "SOL", amount: 1.5 })).toBe("1.5000 SOL");
  });

  it("ignores a stored shown value that is not a number", () => {
    const garbled = { symbol: "SPYx", amount: 4, shown: "x" as unknown as number };
    expect(activityAmount(garbled)).toBe("4.0000 SPYx (raw tokens)");
  });
});
