import type { AssetKind } from "../domain/wallet.js";

/** A stock as the catalog lists it: the token registry's entry, less what only a client needs. */
export type ListedStock = {
  symbol: string;
  name: string;
  issuer: string;
  kind: "company" | "fund";
  /** Whether a logo for it is stored under public/asset-logos/stocks. */
  logo: boolean;
  /** Still held, valued and sold, no longer offered to buy. */
  retired?: boolean;
};

/** A live price per shown unit and its daily change in percent. */
export type LivePrice = { usd: number; change24h: number };

/** What the catalog reads: the stock list, and the live prices and multipliers as they stand. */
export type MarketData = {
  stocks: readonly ListedStock[];
  livePrice(symbol: string): LivePrice | undefined;
  stockMultiplier(symbol: string): number | undefined;
};

type Asset = {
  symbol: string;
  name: string;
  kind: AssetKind;
  logo?: string;
  issuer?: string;
  /** Stocks only: an index or ETF tracker rather than a single company. */
  fund?: boolean;
  /** Stocks only: still held, valued and sold, no longer offered to buy. */
  retired?: boolean;
};

function stockAsset(stock: ListedStock): Asset {
  return {
    symbol: stock.symbol,
    name: stock.name,
    kind: "stock",
    logo: stock.logo ? `/asset-logos/stocks/${stock.symbol}.png` : undefined,
    issuer: stock.issuer,
    fund: stock.kind === "fund",
    retired: stock.retired,
  };
}

/** USDC is the unit every price is quoted in. */
const UNIT_PRICE = { usd: 1, change24h: 0 };

/**
 * What the app shows for each asset it knows, read from `market`. There is
 * no stored price here: a price is a live figure from Jupiter or it is
 * absent, and every surface says so rather than showing an old or typed-in
 * number.
 */
export function createCatalog(market: MarketData) {
  const assets: Asset[] = [
    { symbol: "USDC", name: "USD Coin", kind: "cash", logo: "/asset-logos/usdc.svg" },
    { symbol: "SOL", name: "Solana", kind: "crypto", logo: "/asset-logos/sol.svg" },
    ...market.stocks.map(stockAsset),
  ];
  const bySymbol = new Map(assets.map((asset) => [asset.symbol, asset]));
  const listed = new Map(market.stocks.map((stock) => [stock.symbol, stock]));

  function isStock(symbol: string) {
    return bySymbol.get(symbol)?.kind === "stock";
  }

  /**
   * The price of one unit as the app shows it: a dollar for USDC, a SOL, or
   * one share-equivalent of a stock. Undefined while there is no live price.
   */
  function shownPrice(symbol: string) {
    return symbol === "USDC" ? UNIT_PRICE : market.livePrice(symbol);
  }

  /**
   * How many shown units one held unit is. A stock is held as raw tokens and
   * shown as share-equivalents, the raw amount times the mint's multiplier,
   * which is the issuer's own rule for Solana. Everything else is shown as it
   * is held. Undefined while a stock's multiplier is not known.
   */
  function unitsPerHeld(symbol: string) {
    return isStock(symbol) ? market.stockMultiplier(symbol) : 1;
  }

  /**
   * An amount as it is held (what the chain and the wallet store) in the units
   * the app shows. Undefined when it cannot be shown truthfully yet.
   */
  function shownUnits(symbol: string, held: number) {
    const factor = unitsPerHeld(symbol);
    return factor === undefined ? undefined : held * factor;
  }

  /**
   * Whether the asset can be valued right now: a live market price and, for a
   * stock, its multiplier. USDC is the unit, so always true.
   */
  function isLivePrice(symbol: string) {
    return shownPrice(symbol) !== undefined && unitsPerHeld(symbol) !== undefined;
  }

  /**
   * The catalog entry with its live price per shown unit and its daily change.
   * Both are 0 while there is no live price, so anything showing or deciding on
   * them checks `isLivePrice` first.
   */
  function asset(symbol: string) {
    const entry = bySymbol.get(symbol);
    if (!entry) return undefined;
    const live = isLivePrice(symbol) ? shownPrice(symbol) : undefined;
    return { ...entry, price: live?.usd ?? 0, change24h: live?.change24h ?? 0 };
  }

  /**
   * Dollars per unit as held, or 0 while there is no live price. A holding's
   * value is its stored amount times this. For a stock that is the per-share
   * price times the multiplier, because the stored amount is raw tokens.
   */
  function price(symbol: string) {
    if (!isLivePrice(symbol)) return 0;
    return shownPrice(symbol)!.usd * unitsPerHeld(symbol)!;
  }

  /**
   * Whether this symbol is an investment position rather than the cash it was
   * bought with. Cash (USDC) and the network's own token (SOL) are not - they
   * are what a position is priced in, so folding them into profit and loss
   * would report a gain every time the wallet was topped up.
   */
  function isPosition(symbol: string) {
    return asset(symbol)?.kind === "stock";
  }

  /** A stock that can be held, listed or retired. Buying checks `retired` on top. */
  function listedStock(symbol: string): ListedStock | undefined {
    return listed.get(symbol);
  }

  return {
    asset,
    isLivePrice,
    price,
    shownUnits,
    unitsPerHeld,
    isPosition,
    listedStock,
    /**
     * Everything the app offers to buy, deepest market first.
     *
     * Built from the token registry, so a display entry that has no mint behind
     * it can never reach a trade surface. The two drifting apart is exactly how a
     * user ends up looking at a buy button for something the router has never
     * heard of.
     */
    TRADABLE: assets.filter((entry) => entry.kind === "stock" && !entry.retired),
  };
}

export type Catalog = ReturnType<typeof createCatalog>;
