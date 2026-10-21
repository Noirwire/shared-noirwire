import { describe, expect, it } from "vitest";
import type { OrderbookMarket } from "../../../src/domain/orderbook/market.js";
import {
  orderbookUnitsFromLotSize,
  priceToChainAtoms,
  sizeToLots,
} from "../../../src/domain/orderbook/units.js";
import { validateOrderbookOrder } from "../../../src/domain/orderbook/validation.js";

const MARKET: Pick<OrderbookMarket, "lotSize" | "tickSize" | "minLots" | "minNotional"> = {
  lotSize: "0.1",
  tickSize: "0.01",
  minLots: 1n,
  minNotional: 0n,
};

const check = (size: string, price: string, market = MARKET) =>
  validateOrderbookOrder({ size, price }, market);

describe("validateOrderbookOrder: quantity", () => {
  it("accepts a whole number of lots", () => {
    expect(check("1.0", "150.00").valid).toBe(true);
  });

  it("refuses a size that is not a whole number of lots", () => {
    expect(check("1.05", "150.00").errors.quantity).toBe("quantityNotMultipleOfLot");
    expect(check("0.05", "150.00").errors.quantity).toBe("quantityNotMultipleOfLot");
  });

  it("refuses a size with more decimals than the arithmetic holds as off the lot", () => {
    expect(check("1.0000000001", "150.00").errors.quantity).toBe("quantityNotMultipleOfLot");
  });

  it("refuses a size under the market's minimum number of lots", () => {
    const market = { ...MARKET, minLots: 5n };
    expect(check("0.4", "150.00", market).errors.quantity).toBe("quantityBelowMinimum");
    expect(check("0.5", "150.00", market).valid).toBe(true);
  });

  it("asks for a size that is blank, zero or not a number", () => {
    expect(check("", "150.00").errors.quantity).toBe("quantityRequired");
    expect(check("0", "150.00").errors.quantity).toBe("quantityRequired");
    expect(check("abc", "150.00").errors.quantity).toBe("quantityRequired");
    expect(check("", "150.00").valid).toBe(false);
  });
});

describe("validateOrderbookOrder: price", () => {
  it("refuses a price off the tick", () => {
    expect(check("1.0", "150.005").errors.price).toBe("priceNotMultipleOfTick");
  });

  it("asks for a price on every order", () => {
    expect(check("1.0", "").errors.price).toBe("priceRequired");
  });

  it("refuses a price that is not above zero", () => {
    expect(check("1.0", "0").errors.price).toBe("priceNotPositive");
  });
});

describe("validateOrderbookOrder: minimum notional", () => {
  const market = { ...MARKET, minNotional: 10_000_000n };

  it("refuses an order whose size times price is under the market's minimum", () => {
    const result = check("0.1", "50.00", market);
    expect(result.valid).toBe(false);
    expect(result.errors.quantity).toBe("notionalBelowMinimum");
  });

  it("accepts an order exactly at the minimum", () => {
    expect(check("0.2", "50.00", market).valid).toBe(true);
  });

  it("refuses exactly what the program refuses: lots times price per lot under the minimum", () => {
    const units = orderbookUnitsFromLotSize(market.lotSize);
    for (const [size, price] of [
      ["0.1", "99.99"],
      ["0.1", "100.00"],
      ["0.3", "33.33"],
      ["0.3", "33.34"],
    ]) {
      const programRefuses =
        sizeToLots(units, size) * priceToChainAtoms(units, price) < market.minNotional;
      expect(check(size, price, market).valid).toBe(!programRefuses);
    }
  });

  it("checks the notional only once size and price are each valid", () => {
    const result = check("0.1", "0", market);
    expect(result.errors).toEqual({ price: "priceNotPositive" });
  });
});
