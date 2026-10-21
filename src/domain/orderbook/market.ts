/**
 * An order book market as plain data: the settings its account holds on
 * chain, read by an app and handed in. Lot and tick are decimal strings in
 * whole base units and in quote per whole base unit, the units a trader
 * types. The two minimums stay in the program's own units, as it checks
 * them: lots, and quote atoms.
 */
export type OrderbookMarket = {
  kind: "perp" | "spot";
  /** The size step, in base units ("0.1"). */
  lotSize: string;
  /** The price step, in quote per whole base unit ("0.01"). */
  tickSize: string;
  /** The smallest order, in lots. */
  minLots: bigint;
  /** The smallest size times price, in quote atoms. */
  minNotional: bigint;
  /** The margin an order posts at the least, in basis points of its notional. Null on a spot market. */
  initialMarginBps: number | null;
  /** The margin below which a position is liquidated, in basis points of its notional. Null on a spot market. */
  maintenanceMarginBps: number | null;
  takerFeeBps: number;
  /** The oldest mark, in seconds, the program accepts an order against (`maxPriceAge`). */
  maxPriceAgeSeconds: number;
};

/** The highest leverage a market allows: what its initial margin covers, in whole steps. 1 on a spot market. */
export function orderbookMaxLeverage(market: Pick<OrderbookMarket, "initialMarginBps">): number {
  const initial = market.initialMarginBps;
  if (initial === null || initial <= 0) return 1;
  return Math.max(Math.floor(10_000 / initial), 1);
}

/**
 * The margins a venue that publishes only a maximum leverage implies:
 * initial margin is what that leverage leaves (10000 / maxLeverage, cut to
 * whole basis points so `orderbookMaxLeverage` gives the same leverage
 * back), and maintenance half of it. Null for a market with no leverage. An
 * estimate, for a source that does not serve the market's own figures.
 */
export function impliedOrderbookMargins(
  maxLeverage: number,
): { initialMarginBps: number; maintenanceMarginBps: number } | null {
  if (!(maxLeverage > 0)) return null;
  const initialMarginBps = Math.floor(10_000 / maxLeverage);
  return { initialMarginBps, maintenanceMarginBps: Math.round(initialMarginBps / 2) };
}
