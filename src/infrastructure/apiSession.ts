import {
  createSessionKeeper,
  SessionRefused,
  type IssuedSession,
  type SessionGateway,
  type SessionKeeper,
} from "../application/apiSession.js";
import { apiErrorIn, type ApiError } from "../domain/apiError.js";
import { ChainError } from "../domain/chainError.js";
import { getPlatform } from "../platform.js";
import { apiUrl } from "./api.js";

/** How long a session request may take. One that stalls would hold up every caller waiting on it. */
export const SESSION_REQUEST_TIMEOUT_MS = 10_000;

/** The server's own error in a failed answer, or null when it succeeded or the body is a provider's. */
export async function apiErrorOf(response: Response): Promise<ApiError | null> {
  if (response.ok) return null;
  const seconds = Number(response.headers.get("retry-after"));
  return apiErrorIn(
    response.status,
    await response
      .clone()
      .json()
      .catch(() => null),
    Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined,
  );
}

/** The codes that say a session cannot be renewed and a new one has to be started. */
const NOT_RENEWABLE = ["session_expired", "session_invalid", "unauthorized", "invalid_request"];

async function ask(rest: string, body?: Record<string, string>): Promise<IssuedSession> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), SESSION_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl("session", rest), {
      method: "POST",
      signal: stop.signal,
      ...(body
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    const refusal = await apiErrorOf(response);
    if (refusal && NOT_RENEWABLE.includes(refusal.code)) throw new SessionRefused();
    if (refusal) throw refusal;
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
    // The server gives the moment in seconds.
    return { accessToken, refreshToken, expiresAt: expiresAt * 1000 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * NoirWire's server as the source of sessions. A new one is asked for with
 * no body and no token, so nothing about the device, the person or the
 * wallet is sent; a renewal sends the refresh token alone. Each request is
 * given `SESSION_REQUEST_TIMEOUT_MS` and then abandoned. The app talks to
 * nobody else for this.
 */
export const sessionRoutes: SessionGateway = {
  start: () => ask(""),
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

/**
 * `fetch` to NoirWire's server, as this copy of the app: the request carries
 * the session's token.
 *
 * A 401 is the server not taking the token: `unauthorized`, or
 * `session_expired` once the session has run its time. A request that moves
 * nothing is then made once more, with the session renewed or, for an
 * expired one, started again; turned down a second time, it fails as
 * `notAvailableNow`.
 *
 * A request that hands over a signed transaction is never made a second
 * time, and its 401 is handed back as the answer it is. Whoever sent it
 * treats that like any answer short of a clear success: the outcome is not
 * known until the chain says. The session is put right meanwhile, for the
 * next attempt.
 *
 * When no session can be had at all, the request is never sent, and that
 * alone fails a submit as `notAvailableNow`: nothing left the device.
 */
export async function authorizedFetch(input: string, init: AuthorizedInit = {}): Promise<Response> {
  const { asksAgain = (init.method ?? "GET").toUpperCase() === "GET", ...request } = init;
  const token = await keeper.token();
  const response = await fetch(input, bearing(request, token));
  if (response.status !== 401) return response;
  const startOver = (await apiErrorOf(response))?.code === "session_expired";
  if (!asksAgain) {
    void keeper.renew(token, startOver).catch(() => undefined);
    return response;
  }
  const again = await fetch(input, bearing(request, await keeper.renew(token, startOver)));
  if (again.status === 401) throw new ChainError("notAvailableNow");
  return again;
}
