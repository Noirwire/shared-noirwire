export const PRICE_RANGES = ["1D", "1W", "1M"] as const;
export type PriceRange = (typeof PRICE_RANGES)[number];

/**
 * How long a series is reused, matched to its candle size: an hourly series
 * gains a candle every hour, a 4-hour or daily one far less often, so caching
 * the coarse ranges longer costs no accuracy.
 */
export const SERIES_TTL_SECONDS: Record<PriceRange, number> = {
  "1D": 5 * 60,
  "1W": 30 * 60,
  "1M": 6 * 60 * 60,
};
