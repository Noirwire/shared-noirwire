import { FIXED_POINT_SCALE, isDecimalText, readFixedPoint } from "./decimal.js";
import type { OrderbookMarket } from "./market.js";
import { ORDERBOOK_QUOTE_DECIMALS } from "./units.js";

export type OrderbookOrderError =
  | "quantityRequired"
  | "quantityNotMultipleOfLot"
  | "quantityBelowMinimum"
  | "notionalBelowMinimum"
  | "priceRequired"
  | "priceNotMultipleOfTick"
  | "priceNotPositive";

export type OrderbookOrderValidation = {
  valid: boolean;
  errors: Partial<Record<"quantity" | "price", OrderbookOrderError>>;
};

/** Quote atoms at the fixed-point scale squared, which is what a size times a price comes to. */
const ATOMS_TO_NOTIONAL =
  (FIXED_POINT_SCALE * FIXED_POINT_SCALE) / 10n ** BigInt(ORDERBOOK_QUOTE_DECIMALS);

function quantityError(
  text: string,
  market: Pick<OrderbookMarket, "lotSize" | "minLots">,
): OrderbookOrderError | null {
  if (!text) return "quantityRequired";
  const quantity = readFixedPoint(text);
  if (quantity === null) {
    return isDecimalText(text) ? "quantityNotMultipleOfLot" : "quantityRequired";
  }
  if (quantity <= 0n) return "quantityRequired";
  const lot = readFixedPoint(market.lotSize) ?? 0n;
  if (lot <= 0n) return null;
  if (quantity % lot !== 0n) return "quantityNotMultipleOfLot";
  return quantity / lot < market.minLots ? "quantityBelowMinimum" : null;
}

function priceError(
  text: string,
  market: Pick<OrderbookMarket, "tickSize">,
): OrderbookOrderError | null {
  if (!text) return "priceRequired";
  const price = readFixedPoint(text);
  if (price === null) return "priceNotMultipleOfTick";
  if (price <= 0n) return "priceNotPositive";
  const tick = readFixedPoint(market.tickSize) ?? 0n;
  return tick > 0n && price % tick !== 0n ? "priceNotMultipleOfTick" : null;
}

/**
 * Checks an order against the market's own settings, as the program does
 * and in its order: the size (a whole number of lots, and at least the
 * market's minimum), the price (positive, on the tick), then the notional
 * (size times price, at least the market's minimum in quote atoms). An
 * order book order always carries a price, a market order's being its
 * worst, so the price is always checked. A notional below the minimum is
 * reported on the quantity, the field that is raised to meet it.
 */
export function validateOrderbookOrder(
  input: { size: string; price: string },
  market: Pick<OrderbookMarket, "lotSize" | "tickSize" | "minLots" | "minNotional">,
): OrderbookOrderValidation {
  const errors: OrderbookOrderValidation["errors"] = {};
  const sizeText = input.size.trim();
  const priceText = input.price.trim();
  const quantity = quantityError(sizeText, market);
  const price = priceError(priceText, market);
  if (quantity) errors.quantity = quantity;
  if (price) errors.price = price;
  if (!quantity && !price) {
    const notional = toFixed(sizeText) * toFixed(priceText);
    if (notional < market.minNotional * ATOMS_TO_NOTIONAL) {
      errors.quantity = "notionalBelowMinimum";
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

function toFixed(text: string): bigint {
  return readFixedPoint(text) ?? 0n;
}
