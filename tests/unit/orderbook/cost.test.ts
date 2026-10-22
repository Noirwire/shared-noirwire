import { describe, expect, it } from "vitest";
import {
  type OrderbookOrderCost,
  orderbookLiquidationPrice,
  orderbookMaxSize,
  orderbookOrderCost,
  orderbookPositionEstimate,
} from "../../../src/domain/orderbook/cost.js";
import {
  fromFixedPoint,
  mulFixedPoint,
  toFixedPoint,
} from "../../../src/domain/orderbook/decimal.js";
import {
  type OrderbookMarket,
  impliedOrderbookMargins,
  orderbookMaxLeverage,
} from "../../../src/domain/orderbook/market.js";

const PERP: OrderbookMarket = {
  kind: "perp",
  lotSize: "0.1",
  tickSize: "0.01",
  minLots: 1n,
  minNotional: 0n,
  initialMarginBps: 1000,
  maintenanceMarginBps: 500,
  takerFeeBps: 5,
  maxPriceAgeSeconds: 90,
};
const SPOT: OrderbookMarket = {
  ...PERP,
  kind: "spot",
  initialMarginBps: null,
  maintenanceMarginBps: null,
};

const fp = toFixedPoint;

function cost(over: Partial<Parameters<typeof orderbookOrderCost>[0]>): OrderbookOrderCost {
  const result = orderbookOrderCost({
    market: PERP,
    side: "buy",
    orderType: "limit",
    size: "10",
    price: "100",
    mark: "100",
    leverage: 2,
    maxSteps: 0,
    funds: { quote: "1000" },
    ...over,
  });
  if (!result) throw new Error("no cost");
  return result;
}

const perpOrder = {
  market: PERP,
  side: "buy" as const,
  orderType: "limit" as const,
  size: "1",
  price: "100",
  mark: "100",
  leverage: 10,
  maxSteps: 16,
  funds: { quote: "100" },
};

describe("the market's leverage", () => {
  it("is what its initial margin covers, and 1 on a spot market", () => {
    expect(orderbookMaxLeverage(PERP)).toBe(10);
    expect(orderbookMaxLeverage({ initialMarginBps: 300 })).toBe(33);
    expect(orderbookMaxLeverage(SPOT)).toBe(1);
  });

  it("implies 10% initial and 5% maintenance margin from 10x, and nothing without leverage", () => {
    expect(impliedOrderbookMargins(10)).toEqual({
      initialMarginBps: 1000,
      maintenanceMarginBps: 500,
    });
    expect(impliedOrderbookMargins(0)).toBeNull();
  });

  it("gives back the same maximum leverage from the margins it implies, 1x to 100x", () => {
    for (let leverage = 1; leverage <= 100; leverage++) {
      expect(orderbookMaxLeverage(impliedOrderbookMargins(leverage)!)).toBe(leverage);
    }
    expect(impliedOrderbookMargins(6)?.initialMarginBps).toBe(1666);
  });
});

describe("orderbookOrderCost: what the program holds a perp order to", () => {
  it("posts the initial margin at the mark for a bid below it, even at the maximum leverage", () => {
    const bid = cost({
      size: "1",
      price: "140",
      mark: "150",
      leverage: 10,
      funds: { quote: "15.07" },
    });
    expect(bid.margin).toBe(fp("15"));
    expect(bid.required).toBe(fp("15.07"));
    expect(bid.shortfall).toBeNull();
    expect(
      cost({ size: "1", price: "140", mark: "150", leverage: 10, funds: { quote: "15.069999" } })
        .shortfall,
    ).toEqual({ asset: "quote", needed: fp("15.07"), available: fp("15.069999") });
  });

  it("keeps the margin at the chosen leverage while that is the larger", () => {
    expect(cost({ size: "1", price: "150", mark: "140", leverage: 10 }).margin).toBe(fp("15"));
    expect(cost({ size: "1", price: "140", mark: "150", leverage: 2 }).margin).toBe(fp("70"));
  });

  it("rounds the initial margin at the mark up to a whole quote atom", () => {
    const odd = cost({
      market: { ...PERP, initialMarginBps: 333 },
      size: "0.1",
      price: "100",
      mark: "100.51",
      leverage: 30,
    });
    expect(odd.margin).toBe(fp("0.334699"));
  });

  it("has no cost on a perp market without a mark above zero", () => {
    expect(orderbookOrderCost({ ...perpOrder, mark: null })).toBeNull();
    expect(orderbookOrderCost({ ...perpOrder, mark: "0" })).toBeNull();
    expect(orderbookOrderCost({ ...perpOrder, mark: "x" })).toBeNull();
  });
});

describe("orderbookOrderCost: fees as the program charges them", () => {
  const TICKED: OrderbookMarket = { ...SPOT, lotSize: "0.001", tickSize: "0.001" };

  it("rounds the fee up to a whole quote atom", () => {
    const buy = cost({ market: TICKED, size: "0.001", price: "150.001", funds: { quote: "1" } });
    expect(buy.notional).toBe(fp("0.150001"));
    expect(buy.fee).toBe(fp("0.000076"));
    expect(buy.required).toBe(fp("0.150077"));
  });

  it("refuses a spot buy one atom short of its lock", () => {
    const at = (quote: string) =>
      cost({ market: TICKED, size: "0.001", price: "150.001", funds: { quote } });
    expect(at("0.150077").shortfall).toBeNull();
    expect(at("0.150077").remaining).toBe(0n);
    expect(at("0.150076").shortfall).toEqual({
      asset: "quote",
      needed: fp("0.150077"),
      available: fp("0.150076"),
    });
  });

  it("leaves one atom per step unlocked for a spot buy that can take", () => {
    const at = (quote: string, orderType: "limit" | "postOnly" = "limit") =>
      cost({
        market: TICKED,
        orderType,
        size: "0.001",
        price: "150.001",
        maxSteps: 32,
        funds: { quote },
      });
    expect(at("0.150109")).toMatchObject({ headroom: fp("0.000032"), shortfall: null });
    expect(at("0.150109").remaining).toBe(0n);
    expect(at("0.150108").shortfall?.needed).toBe(fp("0.150109"));
    expect(at("0.150077", "postOnly")).toMatchObject({ headroom: 0n, shortfall: null });
  });

  it("needs no headroom with no fee, for a spot sell or for a perp order", () => {
    const free = cost({ market: { ...TICKED, takerFeeBps: 0 }, size: "1", maxSteps: 32 });
    expect(free.headroom).toBe(0n);
    expect(
      cost({
        market: TICKED,
        side: "sell",
        size: "1",
        maxSteps: 32,
        funds: { quote: "0", base: "1" },
      }).headroom,
    ).toBe(0n);
    expect(cost({ maxSteps: 32 }).headroom).toBe(0n);
  });

  it("rounds a perp order's reserved fee up as well", () => {
    expect(cost({ size: "0.1", price: "100.01", mark: "100.01" }).fee).toBe(fp("0.005001"));
  });
});

describe("orderbookOrderCost: one margin for every figure", () => {
  it("takes margin and fee at the chosen leverage, and leaves the rest", () => {
    const at2x = cost({ leverage: 2 });
    expect(at2x.notional).toBe(fp("1000"));
    expect(at2x.fee).toBe(fp("0.5"));
    expect(at2x.margin).toBe(fp("500"));
    expect(at2x.required).toBe(fp("500.5"));
    expect(at2x.remaining).toBe(fp("499.5"));
  });

  it("moves what remains by exactly the change in margin when leverage changes", () => {
    const at2x = cost({ leverage: 2 });
    const at10x = cost({ leverage: 10 });
    expect(at10x.margin).toBe(fp("100"));
    expect(at10x.remaining - at2x.remaining).toBe(at2x.margin! - at10x.margin!);
  });

  it("holds the leverage between 1 and the market's maximum", () => {
    expect(cost({ leverage: 50 })).toMatchObject({ leverage: 10, margin: fp("100") });
    expect(cost({ leverage: 0 })).toMatchObject({ leverage: 1, margin: fp("1000") });
    expect(cost({ leverage: Number.NaN }).leverage).toBe(1);
  });

  it("covers a perp order whose margin and fee the funds meet exactly", () => {
    const covered = cost({ leverage: 10, funds: { quote: "100.5" } });
    expect(covered.shortfall).toBeNull();
    expect(covered.remaining).toBe(0n);
  });

  it("names the shortfall when they do not, a short included, whatever base is held", () => {
    const short = cost({ side: "sell", leverage: 10, funds: { quote: "100.4", base: "1000" } });
    expect(short.shortfall).toEqual({
      asset: "quote",
      needed: fp("100.5"),
      available: fp("100.4"),
    });
    expect(short.remaining).toBe(-fp("0.1"));
  });

  it("charges a spot buy its notional and fee", () => {
    const buy = cost({ market: SPOT, size: "2", funds: { quote: "201" } });
    expect(buy).toMatchObject({ margin: null, leverage: null, liquidationPrice: null });
    expect(buy.required).toBe(fp("200.1"));
    expect(buy.shortfall).toBeNull();
    expect(
      cost({ market: SPOT, size: "2", funds: { quote: "200", base: "50" } }).shortfall,
    ).toEqual({ asset: "quote", needed: fp("200.1"), available: fp("200") });
  });

  it("pays a spot sell from the base asset alone", () => {
    const sell = cost({
      market: SPOT,
      side: "sell",
      size: "6.222",
      funds: { quote: "0", base: "6.222" },
    });
    expect(sell.shortfall).toBeNull();
    expect(sell.required).toBe(0n);
  });

  it("refuses a spot sell larger than the base held, or with none known", () => {
    expect(
      cost({ market: SPOT, side: "sell", size: "6.223", funds: { quote: "100000", base: "6.222" } })
        .shortfall,
    ).toEqual({ asset: "base", needed: fp("6.223"), available: fp("6.222") });
    expect(
      cost({ market: SPOT, side: "sell", size: "1", funds: { quote: "500" } }).shortfall?.asset,
    ).toBe("base");
  });

  it("has no cost for a size, price or balance that is not an amount above zero", () => {
    expect(orderbookOrderCost({ ...perpOrder, size: "" })).toBeNull();
    expect(orderbookOrderCost({ ...perpOrder, size: "0" })).toBeNull();
    expect(orderbookOrderCost({ ...perpOrder, price: "-1" })).toBeNull();
    expect(orderbookOrderCost({ ...perpOrder, funds: { quote: "x" } })).toBeNull();
  });
});

describe("orderbookLiquidationPrice: one estimate for the review and the position", () => {
  it("puts a long's below entry and a short's above it, where its margin meets maintenance", () => {
    const at = (side: "buy" | "sell") =>
      orderbookLiquidationPrice({
        side,
        size: fp("1"),
        entryPrice: fp("100"),
        margin: fp("10"),
        maintenanceMarginBps: 500,
      });
    expect(fromFixedPoint(at("buy")!, 6)).toBe("94.736842");
    expect(fromFixedPoint(at("sell")!, 6)).toBe("104.761904");
  });

  it("leaves equity equal to the maintenance margin at that price", () => {
    const size = fp("3.7");
    const entryPrice = fp("142.35");
    const margin = fp("80");
    const price = orderbookLiquidationPrice({
      side: "buy",
      size,
      entryPrice,
      margin,
      maintenanceMarginBps: 500,
    })!;
    const equity = margin + mulFixedPoint(size, price) - mulFixedPoint(size, entryPrice);
    const maintenance = mulFixedPoint(size, price) / 20n;
    expect(equity - maintenance).toBeLessThanOrEqual(10n);
    expect(equity - maintenance).toBeGreaterThanOrEqual(-10n);
  });

  it("comes closer to entry as leverage rises", () => {
    const low = cost({ size: "1", leverage: 2 }).liquidationPrice!;
    const high = cost({ size: "1", leverage: 10 }).liquidationPrice!;
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(fp("100"));
  });

  it("gives the review and the position the same price for the same margin", () => {
    const review = cost({ side: "sell", size: "2", leverage: 4 });
    const position = orderbookPositionEstimate({
      market: PERP,
      size: "-2",
      entryPrice: "100",
      margin: fromFixedPoint(review.margin!, 9),
    });
    expect(position?.liquidationPrice).toBe(review.liquidationPrice);
  });

  it("assumes for a position with no known margin what a review at the maximum leverage takes", () => {
    const review = cost({ size: "2", leverage: 10 });
    const position = orderbookPositionEstimate({ market: PERP, size: "2", entryPrice: "100" });
    expect(position).toEqual({ margin: review.margin, liquidationPrice: review.liquidationPrice });
  });

  it("assumes the initial margin itself where it does not divide into a whole leverage", () => {
    const position = orderbookPositionEstimate({
      market: { initialMarginBps: 300, maintenanceMarginBps: 150 },
      size: "1",
      entryPrice: "100",
    });
    expect(position?.margin).toBe(fp("3"));
  });

  it("has nothing for a flat position, and no price without a maintenance margin", () => {
    expect(orderbookPositionEstimate({ market: PERP, size: "0", entryPrice: "100" })).toBeNull();
    expect(
      orderbookPositionEstimate({ market: SPOT, size: "1", entryPrice: "100" })?.liquidationPrice,
    ).toBeNull();
  });
});

describe("orderbookMaxSize", () => {
  const max = (over: Partial<Parameters<typeof orderbookMaxSize>[0]>) =>
    orderbookMaxSize({
      market: PERP,
      side: "buy",
      orderType: "limit",
      price: "100",
      mark: "100",
      leverage: 10,
      maxSteps: 0,
      funds: { quote: "1000" },
      ...over,
    });

  it("is the most the review will accept at the chosen leverage, on a whole lot", () => {
    for (const leverage of [1, 2, 7, 10]) {
      const size = max({ leverage });
      expect(size % fp("0.1")).toBe(0n);
      const fits = cost({ size: fromFixedPoint(size, 9), leverage });
      const over = cost({ size: fromFixedPoint(size + fp("0.1"), 9), leverage });
      expect(fits.shortfall).toBeNull();
      expect(over.shortfall).not.toBeNull();
    }
  });

  it("shrinks as leverage drops", () => {
    expect(max({ leverage: 1 })).toBeLessThan(max({ leverage: 10 }));
  });

  it("bounds a spot sell by the base held, whatever quote there is", () => {
    expect(max({ market: SPOT, side: "sell", funds: { quote: "0", base: "2.55" } })).toBe(
      fp("2.5"),
    );
  });

  it("bounds a spot buy by notional and fee", () => {
    const size = max({ market: SPOT, funds: { quote: "201" } });
    expect(
      cost({ market: SPOT, size: fromFixedPoint(size, 9), funds: { quote: "201" } }).shortfall,
    ).toBeNull();
    expect(size).toBe(fp("2"));
  });

  it("caps a reduce-only order at the position, whatever the funds", () => {
    expect(max({ side: "sell", funds: { quote: "0" }, reduceOnlyMax: "0.37" })).toBe(fp("0.3"));
  });

  it("is held to the initial margin at the mark for a bid below it", () => {
    const below = { price: "140", mark: "150" };
    expect(max({ ...below, funds: { quote: "15.07" } })).toBe(fp("1"));
    expect(max({ ...below, funds: { quote: "15.069999" } })).toBe(fp("0.9"));
  });

  it("offers a spot buy no size whose rounded fee and step headroom the funds miss", () => {
    const LOTTED: OrderbookMarket = { ...SPOT, lotSize: "0.001" };
    const spot = (quote: string, orderType: "limit" | "postOnly" = "limit") =>
      max({ market: LOTTED, orderType, price: "150", maxSteps: 32, funds: { quote } });
    expect(spot("150.075")).toBe(fp("0.999"));
    expect(spot("150.075032")).toBe(fp("1"));
    expect(spot("150.075031")).toBe(fp("0.999"));
    expect(spot("150.075", "postOnly")).toBe(fp("1"));
    const offered = spot("150.075");
    expect(
      cost({
        market: LOTTED,
        size: fromFixedPoint(offered, 9),
        price: "150",
        maxSteps: 32,
        funds: { quote: "150.075" },
      }).shortfall,
    ).toBeNull();
  });

  it("is zero without a price, funds, or on a perp market a mark", () => {
    expect(max({ price: "" })).toBe(0n);
    expect(max({ funds: { quote: "0" } })).toBe(0n);
    expect(max({ mark: null })).toBe(0n);
  });
});
