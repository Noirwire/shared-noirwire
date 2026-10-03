import { jupiterFetch } from "../solana/config.js";
import { ALL_STOCKS } from "../solana/tokenRegistry.js";

/**
 * Live USD prices from Jupiter's price index, the same venue every trade is
 * routed through, so the number on a stock row and the number at review come
 * from one source instead of a hardcoded catalog.
 *
 * Read on the server and cached, once for everyone: the Jupiter key is shared
 * by every user, so each browser polling it directly would spend that one
 * quota in proportion to how many tabs are open.
 *
 * Jupiter quotes `usdPrice` per displayed token, which for a tokenized stock
 * is one share-equivalent: the raw balance times the mint's display
 * multiplier. It is passed on as it is. The multiplier is applied on the
 * holder's side, read from the mint (see src/infrastructure/prices/multipliers.ts), so
 * a holding is valued as raw amount times multiplier times this price.
 *
 * USDC is not fetched: it is the unit prices are quoted in.
 */

export type LivePrice = { usd: number; change24h: number };

/** Where Jupiter is reached and the headers every request to it carries. */
export type JupiterUpstream = { url: string; headers: () => Record<string, string> };

const SOL_MINT = "So11111111111111111111111111111111111111112";

const MINT_TO_SYMBOL = new Map<string, string>([
  [SOL_MINT, "SOL"],
  ...ALL_STOCKS.map((stock) => [stock.mint.toBase58(), stock.symbol] as [string, string]),
]);

/** The most mints Jupiter prices in one request. */
const IDS_PER_REQUEST = 50;

type IndexedPrice = { usdPrice?: number; priceChange24h?: number };

function idChunks(): string[][] {
  const ids = [...MINT_TO_SYMBOL.keys()];
  return Array.from({ length: Math.ceil(ids.length / IDS_PER_REQUEST) }, (_, index) =>
    ids.slice(index * IDS_PER_REQUEST, (index + 1) * IDS_PER_REQUEST),
  );
}

/** The price of each priced mint in one response, by symbol. Unpriced mints are simply absent. */
export function pricesFrom(
  payload: Record<string, IndexedPrice | null>,
): Record<string, LivePrice> {
  const prices: Record<string, LivePrice> = {};
  for (const [mint, entry] of Object.entries(payload)) {
    const symbol = MINT_TO_SYMBOL.get(mint);
    if (!symbol || !entry || !(typeof entry.usdPrice === "number" && entry.usdPrice > 0)) continue;
    prices[symbol] = { usd: entry.usdPrice, change24h: entry.priceChange24h ?? 0 };
  }
  return prices;
}

/**
 * Every known asset's price, keyed by symbol. The index takes a limited
 * number of mints per request, so the list is read in chunks, one after the
 * other: the route is cached for everyone, so being gentle on the shared key
 * matters more than a second of latency. A chunk that fails leaves its assets
 * without a price rather than failing the rest. Throws when nothing could be
 * read at all.
 */
export async function loadLivePrices(jupiter: JupiterUpstream): Promise<Record<string, LivePrice>> {
  const prices: Record<string, LivePrice> = {};
  let answered = 0;
  for (const ids of idChunks()) {
    try {
      const response = await jupiterFetch(`${jupiter.url}/price/v3?ids=${ids.join(",")}`, {
        headers: jupiter.headers(),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as Record<string, IndexedPrice | null>;
      Object.assign(prices, pricesFrom(payload));
      answered += 1;
    } catch {
      /* this chunk's assets go without a price until the next read */
    }
  }
  if (answered === 0) throw new Error("Jupiter prices could not be read.");
  return prices;
}
