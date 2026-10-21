import { fromFixedPoint, toFixedPoint } from "./decimal.js";

/**
 * Converts between a trader's numbers (a price per whole base unit, a size
 * in base units) and the program's (a price in quote atoms per lot, a size
 * in lots). The quote token of every order book market is counted in six
 * decimals, so a quote amount needs no conversion of its own, and every
 * size and price works at that same six-decimal scale here.
 */
export const ORDERBOOK_QUOTE_DECIMALS = 6;

export type OrderbookUnits = {
  /** How many lots make up one whole base unit. */
  lotsPerUnit: bigint;
  /** The size of one lot, at the six-decimal scale. */
  sizePerLot: bigint;
};

const UNIT_SCALE = 10n ** BigInt(ORDERBOOK_QUOTE_DECIMALS);
const FIXED_POINT_PER_UNIT_SCALE = 1_000n;

function toUnitScale(decimal: string): bigint {
  const fixedPoint = toFixedPoint(decimal);
  if (fixedPoint % FIXED_POINT_PER_UNIT_SCALE !== 0n) {
    throw new Error(`${decimal} carries more precision than ${ORDERBOOK_QUOTE_DECIMALS} decimals`);
  }
  return fixedPoint / FIXED_POINT_PER_UNIT_SCALE;
}

function fromUnitScale(value: bigint, decimals: number): string {
  return fromFixedPoint(value * FIXED_POINT_PER_UNIT_SCALE, decimals);
}

/** The units of a market whose lot is given as a decimal string in base units. */
export function orderbookUnitsFromLotSize(lotSize: string): OrderbookUnits {
  const sizePerLot = toUnitScale(lotSize);
  if (sizePerLot <= 0n || UNIT_SCALE % sizePerLot !== 0n) {
    throw new Error(`lot size ${lotSize} does not divide one base unit at six decimals`);
  }
  return { lotsPerUnit: UNIT_SCALE / sizePerLot, sizePerLot };
}

/** The units of a market from its account's own lot (base atoms per lot) and its base asset's decimals. */
export function orderbookUnitsFromChain(baseLot: bigint, baseDecimals: number): OrderbookUnits {
  const atomsPerUnit = 10n ** BigInt(baseDecimals);
  if (baseLot <= 0n || atomsPerUnit % baseLot !== 0n) {
    throw new Error(`a lot of ${baseLot} base atoms does not divide one base unit`);
  }
  const lotsPerUnit = atomsPerUnit / baseLot;
  if (UNIT_SCALE % lotsPerUnit !== 0n) {
    throw new Error(`a lot of ${baseLot} base atoms is finer than six decimals`);
  }
  return { lotsPerUnit, sizePerLot: UNIT_SCALE / lotsPerUnit };
}

/** A size in base units as a whole number of lots. Throws when it is not one. */
export function sizeToLots(units: OrderbookUnits, size: string): bigint {
  const value = toUnitScale(size);
  if (value % units.sizePerLot !== 0n) throw new Error(`${size} is not a whole number of lots`);
  return value / units.sizePerLot;
}

export function lotsToSize(units: OrderbookUnits, lots: bigint, decimals = 6): string {
  return fromUnitScale(lots * units.sizePerLot, decimals);
}

/** A price per whole base unit as quote atoms per lot. Throws when it is not a whole number of them. */
export function priceToChainAtoms(units: OrderbookUnits, price: string): bigint {
  const value = toUnitScale(price);
  if (value % units.lotsPerUnit !== 0n) {
    throw new Error(`${price} is not a whole number of quote atoms per lot`);
  }
  return value / units.lotsPerUnit;
}

export function chainAtomsToPrice(units: OrderbookUnits, atoms: bigint, decimals = 6): string {
  return fromUnitScale(atoms * units.lotsPerUnit, decimals);
}

/** Quote atoms as a decimal string, for collateral and quote balances. */
export function quoteAtomsToAmount(atoms: bigint, decimals = 6): string {
  return fromUnitScale(atoms, decimals);
}

/** A quote amount as quote atoms. Throws on more than six decimals. */
export function amountToQuoteAtoms(amount: string): bigint {
  return toUnitScale(amount);
}
