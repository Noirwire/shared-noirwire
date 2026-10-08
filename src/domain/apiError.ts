/**
 * Every error NoirWire's server writes itself, by its `code`. The body is
 * `{ code, error }`: the code is what the app acts on, and the sentence
 * beside it is never read here and never shown. Each code has one status.
 * `asksAgain` says whether the same request may get another answer shortly:
 * the server was busy or a service behind it was, and nothing was done.
 */
export const API_ERRORS = {
  invalid_request: { status: 400, asksAgain: false },
  unauthorized: { status: 401, asksAgain: false },
  session_expired: { status: 401, asksAgain: false },
  session_invalid: { status: 401, asksAgain: false },
  origin_not_allowed: { status: 403, asksAgain: false },
  method_not_allowed: { status: 403, asksAgain: false },
  not_found: { status: 404, asksAgain: false },
  request_timeout: { status: 408, asksAgain: true },
  /** The profile program's own refusals of a write, under the names the program gives them. */
  StaleRevision: { status: 409, asksAgain: false },
  ProfileExists: { status: 409, asksAgain: false },
  ProfileMissing: { status: 409, asksAgain: false },
  Paused: { status: 409, asksAgain: false },
  RecordTooLarge: { status: 409, asksAgain: false },
  request_too_large: { status: 413, asksAgain: false },
  refused: { status: 422, asksAgain: false },
  insufficient_payment: { status: 422, asksAgain: false },
  /** Rewards: a signature that is not the key's over the request, or one made too long ago or too far ahead by the server's clock. */
  signature_invalid: { status: 403, asksAgain: false },
  clock_skew: { status: 403, asksAgain: false },
  /** Rewards: the server knows no member by the key. `not_found` on a rewards route says it runs no rewards at all. */
  not_a_member: { status: 404, asksAgain: false },
  /** Rewards: the trade was claimed before, by anyone. */
  already_claimed: { status: 409, asksAgain: false },
  /** Rewards: the invite code sent with a joining is not one the server takes. */
  invite_code_invalid: { status: 422, asksAgain: false },
  /** A trade claimed for rewards that the server cannot see as final yet. Nothing was credited, and it may be shortly. */
  transaction_not_finalized: { status: 422, asksAgain: true },
  /** Rewards: why a trade can never be claimed. It failed, was not the portfolio's, paid NoirWire no fee, or is too old. */
  transaction_failed: { status: 422, asksAgain: false },
  not_a_signer: { status: 422, asksAgain: false },
  no_referral_fee: { status: 422, asksAgain: false },
  outside_claim_window: { status: 422, asksAgain: false },
  rate_limited: { status: 429, asksAgain: true },
  internal_error: { status: 500, asksAgain: true },
  upstream_failed: { status: 502, asksAgain: true },
  /** A provider turned down the server's own keys. Only an operator can change that. */
  upstream_refused: { status: 502, asksAgain: false },
  no_answer: { status: 502, asksAgain: true },
  unavailable: { status: 503, asksAgain: true },
  /** No relayer, no replica that could be used, or no price to charge by. The relayer signed nothing. */
  relayer_unavailable: { status: 503, asksAgain: true },
  upstream_not_reached: { status: 503, asksAgain: true },
  upstream_timeout: { status: 504, asksAgain: true },
  response_timeout: { status: 504, asksAgain: true },
} as const satisfies Record<string, { status: number; asksAgain: boolean }>;

export type ApiErrorCode = keyof typeof API_ERRORS;

/**
 * The server answered with one of its own errors. Its message is the status
 * and the code, for a log or a count: what a person is told is chosen from
 * what the app was doing, never from this.
 */
export class ApiError extends Error {
  constructor(
    /** The server's code. One this version does not know is kept as it came. */
    readonly code: ApiErrorCode | (string & {}),
    readonly status: number,
    /** How long the server asked to be left alone, from its `Retry-After`. Undefined when it did not say. */
    readonly retryAfterMs?: number,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }

  /** Whether asking again may get another answer. A code not known here is judged by its status. */
  get asksAgain(): boolean {
    const known = (API_ERRORS as Record<string, { asksAgain: boolean } | undefined>)[this.code];
    return known ? known.asksAgain : this.status === 429 || this.status >= 500;
  }
}

/**
 * The server's own error in a failed answer's body, or null when the body
 * is someone else's: a provider's error passes through the server as the
 * provider wrote it, and has no `code` that is a string beside an `error`
 * that is one.
 */
export function apiErrorIn(status: number, body: unknown, retryAfterMs?: number): ApiError | null {
  if (status < 400 || typeof body !== "object" || body === null) return null;
  const { code, error } = body as { code?: unknown; error?: unknown };
  return typeof code === "string" && typeof error === "string"
    ? new ApiError(code, status, retryAfterMs)
    : null;
}
