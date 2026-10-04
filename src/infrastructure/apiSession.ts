import {
  createSessionKeeper,
  SessionRefused,
  type IssuedSession,
  type SessionGateway,
  type SessionKeeper,
} from "../application/apiSession.js";
import { ChainError } from "../domain/chainError.js";
import { getPlatform } from "../platform.js";
import { apiUrl } from "./api.js";

/** A moment the server gives in seconds since the epoch is read as that; one in milliseconds as it is. */
const SECONDS_BELOW = 100_000_000_000;

async function ask(rest: string, body: Record<string, string>): Promise<IssuedSession> {
  const response = await fetch(apiUrl("session", rest), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    throw new SessionRefused();
  }
  if (!response.ok) throw new Error(`${response.status} from a session request.`);
  const { accessToken, refreshToken, expiresAt } = (await response.json()) as Partial<
    Record<keyof IssuedSession, unknown>
  >;
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof expiresAt !== "number" ||
    expiresAt <= 0
  ) {
    throw new Error("A session request was answered without a session.");
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: expiresAt < SECONDS_BELOW ? expiresAt * 1000 : expiresAt,
  };
}

/**
 * NoirWire's server as the source of sessions. A new one is asked for with
 * an empty body and no token, so nothing about the device, the person or
 * the wallet is sent; a renewal sends the refresh token alone. The app talks
 * to nobody else for this.
 */
export const sessionRoutes: SessionGateway = {
  start: () => ask("", {}),
  refresh: (refreshToken) => ask("/refresh", { refreshToken }),
};

const apiSession = createSessionKeeper({
  gateway: () => sessionRoutes,
  store: () => getPlatform().sessionStore,
  locks: () => getPlatform().locks,
  maxAgeMs: () => getPlatform().env.sessionMaxAgeMs,
});

export type { SessionKeeper };

let keeper: SessionKeeper = apiSession;

/** Has `next` keep the session instead, or the real keeper again on null. For tests, which start no session. */
export function keepSessionWith(next: SessionKeeper | null): void {
  keeper = next ?? apiSession;
}

/**
 * Forgets the anonymous session. A wallet reset calls it, so the wallet
 * created or imported next is not tied to the deleted one by a session the
 * two would share. The next request makes a new one.
 */
export function dropSession(): Promise<void> {
  return keeper.drop();
}

export type AuthorizedInit = RequestInit & {
  /**
   * True for a request that moves nothing and can be made again: a read, a
   * price, an unsigned transaction to review. Left out, only a `GET` is taken
   * as one.
   */
  asksAgain?: boolean;
};

const bearing = (init: RequestInit, token: string): RequestInit => ({
  ...init,
  headers: {
    ...(init.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${token}`,
  },
});

/** The code the server gives a session it has retired for its age, which a renewal cannot bring back. */
const SESSION_EXPIRED = "session_expired";

async function saysSessionExpired(response: Response): Promise<boolean> {
  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown; error?: unknown } | null;
  const error = payload?.error;
  const code =
    payload?.code ??
    (typeof error === "object" ? (error as { code?: unknown } | null)?.code : error);
  return code === SESSION_EXPIRED;
}

/**
 * `fetch` to NoirWire's server, as this copy of the app: the request carries
 * the session's token.
 *
 * A 401 means the server did not take the token, and so did nothing with the
 * request. A request that moves nothing is then made once more: with the
 * session renewed, or with a new session when the server says this one has
 * run its time. One that hands over a signed transaction, or asks the
 * relayer to sign one, is never made a second time here: the session is put
 * right for the next attempt, and this one ends as `notAvailableNow`, with
 * nothing sent. So does a request made again that is turned down again, and
 * any request for which no session could be had at all.
 */
export async function authorizedFetch(input: string, init: AuthorizedInit = {}): Promise<Response> {
  const { asksAgain = (init.method ?? "GET").toUpperCase() === "GET", ...request } = init;
  const token = await keeper.token();
  const response = await fetch(input, bearing(request, token));
  if (response.status !== 401) return response;
  const startOver = await saysSessionExpired(response);
  if (!asksAgain) {
    void keeper.renew(token, startOver).catch(() => undefined);
    throw new ChainError("notAvailableNow");
  }
  const again = await fetch(input, bearing(request, await keeper.renew(token, startOver)));
  if (again.status === 401) throw new ChainError("notAvailableNow");
  return again;
}
