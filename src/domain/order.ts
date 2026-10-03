export type Side = "buy" | "sell";

/** The terms of a priced order that a replacement price is held against. */
export type OrderTerms = {
  spend: number;
  receiveAtLeast: number;
  quote: { expiresAt?: number; feeBps?: number; gasless?: boolean };
};

/**
 * A priced order as its review shows it. Amounts are in each leg's own
 * units: dollars, or raw stock tokens, never the shown, multiplied amount.
 */
export type PricedOrder = OrderTerms & {
  side: Side;
  receive: number;
  /** Dollars per raw stock token in this quote. */
  unitPrice: number;
  venue: string;
  /** Whether the quote's price was held against this site's price index. */
  priceChecked: boolean;
};

/** The cash side of an order: what a buy spends, or what a sell returns. */
export function cashLeg(order: Pick<PricedOrder, "side" | "spend" | "receive">) {
  return order.side === "buy" ? order.spend : order.receive;
}
