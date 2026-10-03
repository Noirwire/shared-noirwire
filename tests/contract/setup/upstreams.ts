/**
 * The services these tests read, reached directly: there is no relay in a
 * Node test run and no visitor to protect. The same variables the app's
 * server reads, with the same defaults.
 */
export const JUPITER_UPSTREAM_URL = process.env.JUPITER_API_URL?.trim() || "https://api.jup.ag";

/** Optional. Raises Jupiter's keyless rate limit. */
export function jupiterKeyHeaders(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY?.trim();
  return key ? { "x-api-key": key } : {};
}

export const JUPITER_UPSTREAM = { url: JUPITER_UPSTREAM_URL, headers: jupiterKeyHeaders };
