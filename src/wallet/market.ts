import { createCatalog } from "../application/catalog.js";
import { createScreenReads } from "../application/screenReads.js";
import { livePrice } from "../infrastructure/prices/live.js";
import { stockMultiplier } from "../infrastructure/prices/multipliers.js";
import { ALL_STOCKS } from "../infrastructure/solana/tokenRegistry.js";

/**
 * The catalog and the reads built on it, bound to this app's token registry,
 * live prices and stock multipliers. Everything that shows or values an asset
 * reads it from here; the application layer takes it as a parameter, and so
 * does every view model (`screenReads`).
 */
export const catalog = createCatalog({ stocks: ALL_STOCKS, livePrice, stockMultiplier });

export const screenReads = createScreenReads(catalog);

export const {
  asset,
  canonicalSymbol,
  isLivePrice,
  price,
  shownUnits,
  unitsPerHeld,
  isPosition,
  TRADABLE,
} = catalog;

export const {
  holdingValue,
  investedHoldings,
  portfolioValue,
  totalValue,
  dayChangeFor,
  portfolioDayChange,
  portfolioOverview,
  positionAcross,
  pieProblem,
  pieSlices,
  piePriced,
  searchMarkets,
  marketsByCategory,
  topMovers,
} = screenReads;

export { activePortfolios, archivedPortfolios, cashOf } from "../application/portfolio.js";
