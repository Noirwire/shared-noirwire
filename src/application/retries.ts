import { ApiError } from "../domain/apiError.js";
import { ChainError } from "../domain/chainError.js";

/**
 * Quiet retries for reads. A balance, a price or a recipient that could not
 * be read on a busy moment is asked for again, a few times and with a short
 * growing pause, before anyone is told it failed.
 *
 * Only reads. Nothing that signs, submits or could move money is ever run
 * through this: a second attempt at one of those can do the same thing
 * twice. And only failures of the asking itself: an answer, however
 * unwelcome, is an answer, and asking again would not change it.
 */

export type RetryOptions = {
  /** How many times `attempt` runs at most, the first included. */
  tries: number;
  /** The pause before the second try. Each later pause is twice the one before. */
  pauseMs: number;
  /** Whether a thrown failure is worth another try. Anything else is thrown at once. */
  retryable: (error: unknown) => boolean;
  /**
   * Stretches each pause by up to this share of itself, at random, so callers
   * refused together do not all come back together. None when left out.
   */
  jitter?: number;
  /** A number from 0 up to 1 for the jitter. `Math.random` when left out. */
  random?: () => number;
};

/** How a read is retried unless its caller says otherwise: three tries, 400 ms and then 800 ms apart. */
export const READ_RETRY = { tries: 3, pauseMs: 400 } as const;

const TRANSPORT_WORDS =
  /fetch failed|failed to fetch|network request failed|networkerror|load failed|timed? ?out|aborted|socket hang up|econn|enotfound/i;

/** An answer that only says the service was busy or broken: 429 or any 5xx. */
const BUSY_STATUS = /^(429|5\d\d)\b|\breturned (429|5\d\d)\b/;

/** Whether `message` is how a request that never got its answer describes itself. */
export function saysTransportFailure(message: string): boolean {
  return TRANSPORT_WORDS.test(message);
}

/** Whether a status is the service saying it was busy or broken, not an answer to the question. */
export function isBusyStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Whether a thrown failure is of the asking, not an answer: the request never
 * got through, ran out of time, or came back 429 or 5xx. A `ChainError` is a
 * typed refusal and never is. An error NoirWire's server wrote itself is
 * judged by its code, not its words.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof ApiError) return error.asksAgain;
  if (error instanceof ChainError || !(error instanceof Error)) return false;
  if (error.name === "TypeError" || error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }
  return saysTransportFailure(error.message) || BUSY_STATUS.test(error.message);
}

/**
 * Runs `attempt` until it resolves, at most `tries` times, pausing between
 * tries. A failure that is not `retryable` is thrown at once; the last
 * failure is thrown as it was.
 */
export async function withRetries<T>(attempt: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { tries, pauseMs, retryable, jitter = 0, random = Math.random } = options;
  for (let tried = 1; ; tried++) {
    try {
      return await attempt();
    } catch (error) {
      if (tried >= tries || !retryable(error)) throw error;
      const pause = pauseMs * 2 ** (tried - 1) * (1 + jitter * random());
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }
}

/** `attempt` as a read: retried on a failure of the asking, by `READ_RETRY`. */
export function readWithRetries<T>(attempt: () => Promise<T>): Promise<T> {
  return withRetries(attempt, { ...READ_RETRY, retryable: isTransient });
}
