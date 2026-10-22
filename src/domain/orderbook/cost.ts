import type { Side } from "../order.js";
import { FIXED_POINT_SCALE, mulFixedPoint, readFixedPoint } from "./decimal.js";
import { type OrderbookMarket, orderbookMaxLeverage } from "./market.js";
import { ORDERBOOK_QUOTE_DECIMALS } from "./units.js";

/** What a trader holds to pay for an order, as decimal strings: quote, and for a spot sell the base asset. */
export type OrderbookFunds = { quote: string; base?: string };

/** The program's order types. Only a post-only order never takes, which changes what a spot bid must hold. */
export type OrderbookOrderType = "limit" | "postOnly" | "immediateOrCancel" | "market";

export type OrderbookShortfall = {
  /** The balance that falls short: the base asset for a spot sell, quote for every other order. */
  asset: "base" | "quote";
  needed: bigint;
  available: bigint;
};

/** An order's cost, every amount at the fixed-point scale. */
export type OrderbookOrderCost = {
  notional: bigint;
  /** The taker fee on the notional, rounded up to a whole quote atom, as the program charges it. */
  fee: bigint;
  /** The leverage asked for, held between 1 and the market's maximum. Null on a spot market. */
  leverage: number | null;
  /**
   * The margin the order posts: its notional at that leverage, and never less
   * than the market's initial margin on its size at the mark, which is what
   * the program holds it to. Null on a spot market.
   */
  margin: bigint | null;
  /** The quote the order takes from the available balance: margin and fee, notional and fee for a spot buy, nothing for a spot sell. */
  required: bigint;
  /**
   * Quote a spot buy that can take must leave unlocked beside `required`:
   * one atom for each fill the fee is rounded up on, up to the exchange's
   * step limit. Zero for every other order and on a market with no fee.
   */
  headroom: bigint;
  /** The quote left once `required` and `headroom` are set aside. Below zero when the order cannot be paid for. */
  remaining: bigint;
  shortfall: OrderbookShortfall | null;
  /** Where the position this order opens would be liquidated, with its margin alone behind it. Null on a spot market. */
  liquidationPrice: bigint | null;
};

const BPS = 10_000n;
const QUOTE_ATOM = FIXED_POINT_SCALE / 10n ** BigInt(ORDERBOOK_QUOTE_DECIMALS);
const MAX_FILLS = 32;

function heldLeverage(market: Pick<OrderbookMarket, "initialMarginBps">, leverage: number): number {
  const asked = Number.isFinite(leverage) ? Math.floor(leverage) : 1;
  return Math.min(Math.max(asked, 1), orderbookMaxLeverage(market));
}

function wholeBps(bps: number | null): bigint {
  return bps === null ? 0n : BigInt(Math.round(bps));
}

/** `bps` of size times price, at the fixed-point scale, rounded up to a whole quote atom. */
function bpsOfNotionalUp(size: bigint, price: bigint, bps: bigint): bigint {
  const atom = FIXED_POINT_SCALE * BPS * QUOTE_ATOM;
  return ((size * price * bps + atom - 1n) / atom) * QUOTE_ATOM;
}

function feeRoundingHeadroom(
  takerFeeBps: number,
  orderType: OrderbookOrderType,
  maxSteps: number,
): bigint {
  if (takerFeeBps <= 0 || orderType === "postOnly") return 0n;
  const steps = Number.isFinite(maxSteps) ? Math.max(Math.ceil(maxSteps), 0) : MAX_FILLS;
  return BigInt(steps) * QUOTE_ATOM;
}

/**
 * The price at which a position's margin, less what it has lost, falls to
 * the market's maintenance margin. `size` is the position's size in base
 * units and `margin` the quote behind it, both at the fixed-point scale;
 * the maintenance margin is taken on the notional at that price. The one
 * estimate both an order's review and an open position use. Null with no
 * size or no maintenance margin.
 */
export function orderbookLiquidationPrice(params: {
  side: Side;
  size: bigint;
  entryPrice: bigint;
  margin: bigint;
  maintenanceMarginBps: number | null;
}): bigint | null {
  const { side, size, entryPrice, margin, maintenanceMarginBps } = params;
  if (size <= 0n || entryPrice <= 0n || maintenanceMarginBps === null) return null;
  const entryNotional = mulFixedPoint(size, entryPrice);
  const maintenance = wholeBps(maintenanceMarginBps);
  const price =
    side === "buy"
      ? ((entryNotional - margin) * FIXED_POINT_SCALE * BPS) / (size * (BPS - maintenance))
      : ((entryNotional + margin) * FIXED_POINT_SCALE * BPS) / (size * (BPS + maintenance));
  return price < 0n ? 0n : price;
}

type PricedMarket = Pick<OrderbookMarket, "kind" | "initialMarginBps" | "takerFeeBps">;

/** How an order is priced, read once: the size is what varies. */
type Pricing = {
  market: PricedMarket;
  price: bigint;
  /** The mark, above zero on a perp market; unused on a spot market. */
  mark: bigint;
  leverage: number;
  headroom: bigint;
};

function quoteNeeded(size: bigint, pricing: Pricing) {
  const { market, price, mark, leverage } = pricing;
  const notional = mulFixedPoint(size, price);
  const fee = bpsOfNotionalUp(size, price, wholeBps(market.takerFeeBps));
  if (market.kind === "spot") return { notional, fee, margin: null, required: notional + fee };
  const atLeverage = notional / BigInt(leverage);
  const atMark = bpsOfNotionalUp(size, mark, wholeBps(market.initialMarginBps));
  const margin = atLeverage > atMark ? atLeverage : atMark;
  return { notional, fee, margin, required: margin + fee };
}

/**
 * Reads what prices an order. Null when the price is not an amount above
 * zero, or on a perp market when the mark is not.
 */
function readPricing(params: {
  market: PricedMarket;
  side: Side;
  orderType: OrderbookOrderType;
  price: string;
  mark: string | null;
  leverage: number;
  maxSteps: number;
}): Pricing | null {
  const { market } = params;
  const price = readFixedPoint(params.price);
  if (price === null || price <= 0n) return null;
  if (market.kind === "spot") {
    return {
      market,
      price,
      mark: 0n,
      leverage: 1,
      headroom:
        params.side === "buy"
          ? feeRoundingHeadroom(market.takerFeeBps, params.orderType, params.maxSteps)
          : 0n,
    };
  }
  const mark = params.mark === null ? null : readFixedPoint(params.mark);
  if (mark === null || mark <= 0n) return null;
  return { market, price, mark, leverage: heldLeverage(market, params.leverage), headroom: 0n };
}

/**
 * What an order costs and whether the funds cover it, as the program checks
 * it at acceptance on an account with nothing else open: margin, the quote
 * it takes, what is left and the liquidation estimate are worked from the
 * same margin, so a review cannot show one leverage's margin beside another's
 * remaining balance. A perp order's margin is at least the market's initial
 * margin at the mark, and its fee is reserved beside it. A spot buy pays
 * notional and fee and, unless it is post-only, leaves one quote atom per
 * step of the exchange's limit (`maxSteps`) unlocked for the fee rounding of
 * each fill. A spot sell spends the base asset it sells. Fees round up to a
 * whole quote atom. Null when the size, the price or the funds are not
 * amounts above zero, or on a perp market when the mark is not.
 */
export function orderbookOrderCost(params: {
  market: PricedMarket & Pick<OrderbookMarket, "maintenanceMarginBps">;
  side: Side;
  orderType: OrderbookOrderType;
  size: string;
  price: string;
  /** The market's mark price, per whole base unit. Null on a spot market. */
  mark: string | null;
  leverage: number;
  /** The exchange's step limit: the most fills one order makes. */
  maxSteps: number;
  funds: OrderbookFunds;
}): OrderbookOrderCost | null {
  const { market, side } = params;
  const size = readFixedPoint(params.size);
  const availableQuote = readFixedPoint(params.funds.quote);
  const pricing = readPricing(params);
  if (size === null || size <= 0n || availableQuote === null || pricing === null) return null;

  const { notional, fee, margin, required } = quoteNeeded(size, pricing);

  if (market.kind === "spot" && side === "sell") {
    const availableBase = readFixedPoint(params.funds.base ?? "0") ?? 0n;
    return {
      notional,
      fee,
      leverage: null,
      margin: null,
      required: 0n,
      headroom: 0n,
      remaining: availableQuote,
      shortfall:
        size <= availableBase ? null : { asset: "base", needed: size, available: availableBase },
      liquidationPrice: null,
    };
  }

  const { headroom } = pricing;
  const needed = required + headroom;
  return {
    notional,
    fee,
    leverage: margin === null ? null : pricing.leverage,
    margin,
    required,
    headroom,
    remaining: availableQuote - needed,
    shortfall:
      needed <= availableQuote ? null : { asset: "quote", needed, available: availableQuote },
    liquidationPrice:
      margin === null
        ? null
        : orderbookLiquidationPrice({
            side,
            size,
            entryPrice: pricing.price,
            margin,
            maintenanceMarginBps: market.maintenanceMarginBps,
          }),
  };
}

export type OrderbookPositionEstimate = {
  /** The margin assumed behind the position. */
  margin: bigint;
  liquidationPrice: bigint | null;
};

/**
 * An open perp position's margin and liquidation estimate, through the same
 * function an order's review uses. `size` is signed: above zero long, below
 * zero short. With no `margin` known for the position, the market's initial
 * margin on its notional at entry is assumed, rounded up to a quote atom:
 * about the least the program lets it open with, and so about the closest
 * liquidation price. Null for a flat position or one that is not an amount.
 */
export function orderbookPositionEstimate(params: {
  market: Pick<OrderbookMarket, "initialMarginBps" | "maintenanceMarginBps">;
  size: string;
  entryPrice: string;
  margin?: string;
}): OrderbookPositionEstimate | null {
  const signed = readFixedPoint(params.size);
  const entryPrice = readFixedPoint(params.entryPrice);
  if (signed === null || signed === 0n || entryPrice === null || entryPrice <= 0n) return null;
  const size = signed < 0n ? -signed : signed;
  const known = params.margin === undefined ? null : readFixedPoint(params.margin);
  const initial = params.market.initialMarginBps;
  const margin =
    known ??
    (initial === null
      ? mulFixedPoint(size, entryPrice)
      : bpsOfNotionalUp(size, entryPrice, wholeBps(initial)));
  return {
    margin,
    liquidationPrice: orderbookLiquidationPrice({
      side: signed > 0n ? "buy" : "sell",
      size,
      entryPrice,
      margin,
      maintenanceMarginBps: params.market.maintenanceMarginBps,
    }),
  };
}

function roundDownToLot(size: bigint, lot: bigint): bigint {
  if (lot <= 0n) return size;
  return size - (size % lot);
}

/** The largest multiple of `step`, no larger than `upper`, that `fits`, for a `fits` that holds up to some size and fails beyond it. */
function largestFitting(step: bigint, upper: bigint, fits: (size: bigint) => boolean): bigint {
  let low = 0n;
  let high = upper / step;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (fits(mid * step)) low = mid;
    else high = mid - 1n;
  }
  return low * step;
}

/**
 * The largest size an order could take, on a whole lot, so a quantity
 * shortcut offers nothing the review would then refuse as unaffordable: it
 * is the largest size `orderbookOrderCost` covers, with the same inputs. A
 * reduce-only order is capped by the position it reduces (closing needs no
 * margin), and a spot sell by the base asset held. At the fixed-point scale;
 * zero when the price or the funds are not amounts above zero, or on a perp
 * market when the mark is not.
 */
export function orderbookMaxSize(params: {
  market: PricedMarket & Pick<OrderbookMarket, "lotSize">;
  side: Side;
  orderType: OrderbookOrderType;
  price: string;
  mark: string | null;
  leverage: number;
  maxSteps: number;
  funds: OrderbookFunds;
  reduceOnlyMax?: string;
}): bigint {
  const { market } = params;
  const lot = readFixedPoint(market.lotSize) ?? 0n;
  const floorAtZero = (size: bigint | null) =>
    roundDownToLot(size !== null && size > 0n ? size : 0n, lot);
  if (params.reduceOnlyMax !== undefined) return floorAtZero(readFixedPoint(params.reduceOnlyMax));
  if (market.kind === "spot" && params.side === "sell") {
    return floorAtZero(readFixedPoint(params.funds.base ?? "0"));
  }

  const pricing = readPricing(params);
  const available = readFixedPoint(params.funds.quote);
  if (pricing === null || available === null || available <= 0n) return 0n;
  const atLeverageOnly = (available * BigInt(pricing.leverage) * FIXED_POINT_SCALE) / pricing.price;
  return largestFitting(
    lot > 0n ? lot : 1n,
    atLeverageOnly,
    (size) => quoteNeeded(size, pricing).required + pricing.headroom <= available,
  );
}
