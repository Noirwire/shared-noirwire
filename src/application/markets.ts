import type { Catalog } from "./catalog.js";
import type { Wallet } from "../domain/wallet.js";

export type MarketCategory = "all" | "index" | "companies" | "watchlist";

/** How many rows a market list shows before "Show more", and how many each press adds. */
export const MARKET_PAGE_SIZE = 25;

/** How many assets a featured shelf shows. The full set is one filter away. */
export const SHELF_SIZE = 6;

/** A ticker without the issuer's suffix, so "nvda" finds NVDAx. */
function underlying(symbol: string) {
  return symbol.replace(/x$/i, "").toLowerCase();
}

/** The market lists, by the catalog `catalog` reads. */
export function createMarketReads(catalog: Pick<Catalog, "asset" | "isLivePrice" | "TRADABLE">) {
  const { asset, isLivePrice, TRADABLE } = catalog;

  function searchMarkets(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return TRADABLE;
    return TRADABLE.filter(
      (entry) =>
        entry.symbol.toLowerCase().includes(q) ||
        entry.name.toLowerCase().includes(q) ||
        underlying(entry.symbol) === q,
    );
  }

  function marketsByCategory(wallet: Pick<Wallet, "watchlist">, category: MarketCategory) {
    if (category === "all") return TRADABLE;
    if (category === "watchlist") {
      return TRADABLE.filter((entry) => wallet.watchlist.includes(entry.symbol));
    }
    return TRADABLE.filter((entry) => Boolean(entry.fund) === (category === "index"));
  }

  function topMovers(updatedAt: number | null) {
    if (updatedAt === null) return [];
    return TRADABLE.filter((entry) => isLivePrice(entry.symbol)).sort(
      (a, b) =>
        Math.abs(asset(b.symbol)?.change24h ?? 0) - Math.abs(asset(a.symbol)?.change24h ?? 0),
    );
  }

  return { searchMarkets, marketsByCategory, topMovers };
}
