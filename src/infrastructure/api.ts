import { getPlatform } from "../platform.js";

/**
 * Where every client in this folder sends its requests: NoirWire's own
 * server, at the one place the installed `Env` names as `apiBaseUrl`. On the
 * phone that is the server's origin. On the web it may be a path on the
 * page's own origin (`/api`) that the host forwards to the server, so the
 * page connects to nothing but itself. The chain's provider, the swap venue
 * and the private-payment service are behind it, so each of them sees the
 * server's address and never a visitor's next to the addresses it is asked
 * about. Their real URLs and keys belong to the server.
 */
const ROUTES = {
  /** `POST` to start an anonymous session, and `/refresh` after it to renew one. The only `/v1` route that takes no session. */
  session: "/v1/session",
  /** `POST`: the Solana RPC. */
  rpc: "/v1/rpc",
  /** `GET` and `POST`: the swap venue and its lending, by the venue's own path after it. */
  jupiter: "/v1/jupiter",
  /** `POST`: the private-payment service, by its own path after it. */
  privatePayments: "/v1/private-payments",
  /** `GET` for the relayer's keys, `POST` for a price or a signature. */
  relayer: "/v1/relayer",
  /** `GET`: live prices. */
  prices: "/v1/prices",
  /** `GET`: a chart's history, as `/:symbol/:range` after it. */
  history: "/v1/history",
  /** `POST`: one counted usage event. */
  events: "/v1/events",
  /** `GET`: whether the server is up. Takes no session. */
  health: "/health",
} as const;

export type ApiRoute = keyof typeof ROUTES;

/**
 * The address of `route` on NoirWire's server, with `rest` after it: a path
 * that starts with a slash, and a query when there is one. The only place a
 * request's address is put together.
 */
export function apiUrl(route: ApiRoute, rest = ""): string {
  return `${getPlatform().env.apiBaseUrl}${ROUTES[route]}${rest}`;
}
