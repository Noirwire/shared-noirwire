import type { Catalog } from "./catalog.js";
import { createMarketReads } from "./markets.js";
import { createPieReads } from "./pie.js";
import {
  activePortfolios,
  archivedPortfolios,
  cashOf,
  createPortfolioReads,
  heldPositions,
} from "./portfolio.js";

/**
 * Everything a screen's view model reads about assets, prices and
 * portfolios, by the catalog it is given: the catalog itself and the
 * valuation, pie and market reads built on it. An app passes the one bound
 * to its price feeds; a test passes one over fixed prices.
 */
export function createScreenReads(catalog: Catalog) {
  return {
    ...catalog,
    ...createPortfolioReads(catalog),
    ...createPieReads(catalog),
    ...createMarketReads(catalog),
    activePortfolios,
    archivedPortfolios,
    cashOf,
    heldPositions,
  };
}

export type ScreenReads = ReturnType<typeof createScreenReads>;
