import { PRICE_HISTORY_API_URL } from "../solana/config.js";
import { stockBySymbol } from "../solana/tokenRegistry.js";
import type { PriceRange } from "../../domain/priceRanges.js";

/**
 * Real price history for charts and sparklines: candle closes for the token
 * itself, from Jupiter's chart data - the same aggregated price its own
 * trading screens draw, across every pool rather than one.
 *
 * Read on the server, once for everyone, and cached. The endpoint is the one
 * Jupiter's site uses rather than part of its documented API, so the contract
 * suite checks its shape; if it ever changes, charts hide and nothing else
 * is affected.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGES: Record<PriceRange, { interval: string; candles: number; spanMs: number }> = {
  "1D": { interval: "1_HOUR", candles: 24, spanMs: DAY_MS },
  "1W": { interval: "4_HOUR", candles: 42, spanMs: 7 * DAY_MS },
  "1M": { interval: "1_DAY", candles: 30, spanMs: 30 * DAY_MS },
};

const TIMEOUT_MS = 8_000;

/**
 * Candle closes for a listed stock, oldest first, or null when there is no
 * usable history. Throws when the source could not be reached, which is a
 * different answer: "try again", not "there is nothing".
 */
export async function loadPriceHistory(
  symbol: string,
  range: PriceRange,
): Promise<number[] | null> {
  const stock = stockBySymbol(symbol);
  if (!stock) return null;
  const mint = stock.mint.toBase58();
  const { interval, candles, spanMs } = RANGES[range];
  const to = Date.now();
  const query = new URLSearchParams({
    interval,
    baseAsset: mint,
    from: String(to - spanMs),
    to: String(to),
    candles: String(candles),
    type: "price",
  });
  const response = await fetch(`${PRICE_HISTORY_API_URL}/v2/charts/${mint}?${query}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Price history returned ${response.status}.`);
  const payload = (await response.json()) as { candles?: Candle[] };
  // A candle is stamped with its opening time, so the first may open one candle before the window.
  return closesWithin(payload.candles ?? [], to - spanMs - spanMs / candles, to);
}

type Candle = { time?: number; close?: number };

/**
 * The closes of the candles that fall inside the window, oldest first, or
 * null when fewer than two do. The order and the window are checked here
 * rather than trusted: a response that came back reversed, or for some other
 * period, would otherwise draw a believable chart of the wrong thing.
 */
export function closesWithin(candles: Candle[], fromMs: number, toMs: number): number[] | null {
  const closes = candles
    .filter(
      (candle): candle is Required<Candle> =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.close) &&
        (candle.close as number) > 0 &&
        (candle.time as number) * 1000 >= fromMs &&
        (candle.time as number) * 1000 <= toMs,
    )
    .sort((a, b) => a.time - b.time)
    .map((candle) => candle.close);
  return closes.length >= 2 ? closes : null;
}
