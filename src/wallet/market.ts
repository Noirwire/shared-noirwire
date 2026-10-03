import { createCatalog } from "../application/catalog.js";
import { createMarketReads } from "../application/markets.js";
import { createPieReads } from "../application/pie.js";
import { createPortfolioReads } from "../application/portfolio.js";
import { livePrice } from "../infrastructure/prices/live.js";
import { stockMultiplier } from "../infrastructure/prices/multipliers.js";
import { ALL_STOCKS } from "../infrastructure/solana/tokenRegistry.js";

/**
 * The catalog and the reads built on it, bound to this app's token registry,
 * live prices and stock multipliers. Everything that shows or values an asset
 * reads it from here; the application layer takes it as a parameter.
 */
export const catalog = createCatalog({ stocks: ALL_STOCKS, livePrice, stockMultiplier });

export const { asset, isLivePrice, price, shownUnits, unitsPerHeld, isPosition, TRADABLE } =
  catalog;

export const {
  holdingValue,
  investedHoldings,
  portfolioValue,
  totalValue,
  dayChangeFor,
  portfolioDayChange,
  portfolioOverview,
  positionAcross,
} = createPortfolioReads(catalog);

export const { pieProblem, pieSlices, piePriced } = createPieReads(catalog);

export const { searchMarkets, marketsByCategory, topMovers } = createMarketReads(catalog);

export { activePortfolios, archivedPortfolios, cashOf } from "../application/portfolio.js";
