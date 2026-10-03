import { SERIES_TTL_SECONDS, type PriceRange } from "../../domain/priceRanges.js";
import { relayInit, relayUrl } from "../httpConfig.js";

/**
 * Price history as an app gets it: from its own relay's `/api/history`,
 * which reads the source once for everyone and caches it.
 *
 * `null` means no history could be read, and every caller hides the chart
 * rather than drawing a plausible-looking line - an invented curve on an
 * investing screen is a claim about the past that nobody made.
 */

/**
 * Held in memory and nowhere else. A series used to be written to
 * localStorage under its symbol, in the clear, where it outlived a lock and
 * told anyone reading this browser's storage which trackers its owner held or
 * looked at. A reload now asks again; the server's copy is cached for
 * everyone, so that costs little.
 */
const seriesCache = new Map<string, { at: number; points: Promise<number[] | null> }>();

async function fetchSeries(symbol: string, range: PriceRange): Promise<number[] | null> {
  const response = await fetch(
    relayUrl(`/api/history/${encodeURIComponent(symbol)}/${range}`),
    relayInit(),
  );
  if (!response.ok) return null;
  const { points } = (await response.json()) as { points: number[] | null };
  return points && points.length >= 2 ? points : null;
}

export function priceHistory(symbol: string, range: PriceRange): Promise<number[] | null> {
  const key = `${symbol}:${range}`;
  const ttlMs = SERIES_TTL_SECONDS[range] * 1000;
  const cached = seriesCache.get(key);
  if (cached && Date.now() - cached.at < ttlMs) return cached.points;
  const points = fetchSeries(symbol, range).catch(() => null);
  seriesCache.set(key, { at: Date.now(), points });
  // Only a real series is kept. A failure is forgotten at once, so the next
  // render asks again instead of hiding the chart for the whole TTL.
  void points.then((result) => {
    if (!result && seriesCache.get(key)?.points === points) seriesCache.delete(key);
  });
  return points;
}
