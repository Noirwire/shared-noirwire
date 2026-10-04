import { ChainError } from "../domain/chainError.js";
import type { Locks, SessionStore } from "../platform.js";

/**
 * The app's anonymous session with NoirWire's server. It is a quota bucket,
 * not an identity: it lets the server count one running copy of the app's
 * requests apart from another's, and nothing more. It has no email and no
 * account behind it, and nothing in it is, or is derived from, anything in
 * the wallet: no address, no key, no phrase, no password. It is made before
 * a wallet exists and is the same whether one is unlocked or not.
 *
 * It does not last. A session older than a day is replaced by a new one, not
 * renewed, so what the server could count under one session never covers
 * more than a day. Resetting the wallet drops it at once: a session that
 * outlived a reset would let the server tie the wallet imported afterwards
 * to the one that was deleted, which is exactly the link a reset is expected
 * to cut.
 */
export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops being accepted, in milliseconds since the epoch. */
  expiresAt: number;
};

/** A session as it is kept: what was issued, and when its first token was. */
export type ApiSession = IssuedSession & {
  /** When this session began, on this device's clock. A renewal keeps it; a new session starts it again. */
  startedAt: number;
};

/** The server answered and said no. Asking the same thing again would get the same answer. */
export class SessionRefused extends Error {
  constructor() {
    super("The session was refused.");
    this.name = "SessionRefused";
  }
}

/**
 * Where sessions come from, as the keeper needs it. Either call throws
 * `SessionRefused` for a refusal, and anything else when no answer was had.
 */
export interface SessionGateway {
  /** A new anonymous session. */
  start(): Promise<IssuedSession>;
  /** The next tokens of the session `refreshToken` belongs to. */
  refresh(refreshToken: string): Promise<IssuedSession>;
}

export interface SessionKeeper {
  /** A token the server should accept, renewed first when the one held is about to run out. */
  token(): Promise<string>;
  /**
   * A token other than `refused`, which the server just turned down. With
   * `startOver`, by a new session and not a renewal: the server said the
   * session itself has run its time.
   */
  renew(refused: string, startOver?: boolean): Promise<string>;
  /** Forgets the session, here and in storage. The next `token()` makes a new one. */
  drop(): Promise<void>;
}

/** A token this close to running out is renewed before it is used. */
export const RENEW_BEFORE_EXPIRY_MS = 60_000;

/**
 * How old a session may get before it is replaced by a new one: a day, which
 * is also when the server retires one unless it is set otherwise.
 */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The platform lock a renewal and a drop run under, so two tabs never spend the same refresh token, and a drop is not undone by a renewal that was under way elsewhere. */
export const SESSION_LOCK = "noirwire-session";

/**
 * How long nothing more is asked after a session could not be had: a second
 * after the first failure, twice as long after each one that follows, a
 * minute at most, each stretched by up to half at random so copies of the
 * app that failed together do not come back together.
 */
export const SESSION_RETRY = { firstMs: 1_000, capMs: 60_000, jitter: 0.5 } as const;

function parsed(raw: string | null): ApiSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ApiSession> | null;
    return value &&
      typeof value.accessToken === "string" &&
      typeof value.refreshToken === "string" &&
      typeof value.expiresAt === "number" &&
      typeof value.startedAt === "number"
      ? {
          accessToken: value.accessToken,
          refreshToken: value.refreshToken,
          expiresAt: value.expiresAt,
          startedAt: value.startedAt,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * Keeps one session: read from storage, started when there is none, renewed
 * shortly before its token runs out and whenever the server turns it down,
 * and replaced by a new one once it is `maxAgeMs` old.
 *
 * Storage is the truth, for every tab. What is held here is checked against
 * it before each use, so a session another tab renewed is taken up, and one
 * another tab dropped is not used again. Only when the store cannot be read,
 * or would not keep what it was given, does the copy held here stand alone.
 *
 * Callers that arrive together share one start or renewal, and it runs under
 * the platform lock, so another tab or process that got there first is found
 * in storage and used instead of spending the same refresh token twice. A
 * drop takes the same lock: a renewal under way anywhere finishes first, and
 * what it stored is then removed. A renewal the server refuses is followed
 * by a new session.
 *
 * When no session can be had, the failure is `notAvailableNow`, and for a
 * while (`SESSION_RETRY`) every caller is told so at once without the server
 * being asked again.
 *
 * Its collaborators are read each time they are needed, never when this is
 * made, so it can be made before the platform is installed.
 */
export function createSessionKeeper(deps: {
  gateway: () => SessionGateway;
  store: () => SessionStore;
  locks: () => Locks;
  /** `SESSION_MAX_AGE_MS` when left out or when it answers nothing. */
  maxAgeMs?: () => number | undefined;
  /** A number from 0 up to 1 for the retry delay's jitter. `Math.random` when left out. */
  random?: () => number;
}): SessionKeeper {
  let held: ApiSession | null = null;
  /** False once the store would not keep a session: from then on storage says nothing about `held`. */
  let storeKeeps = true;
  let renewing: Promise<ApiSession> | null = null;
  /** Moves on every drop, so a renewal that finishes after one is not kept. */
  let dropped = 0;
  let failures = 0;
  let askAgainAt = 0;

  const expired = (session: ApiSession) => session.expiresAt <= Date.now();
  const tooOld = (session: ApiSession) =>
    Date.now() - session.startedAt >= (deps.maxAgeMs?.() ?? SESSION_MAX_AGE_MS);
  const fresh = (session: ApiSession) =>
    !tooOld(session) && session.expiresAt - Date.now() > RENEW_BEFORE_EXPIRY_MS;

  /** What is stored, or undefined when the store cannot be read. */
  async function stored(): Promise<ApiSession | null | undefined> {
    try {
      return parsed(await deps.store().get());
    } catch {
      return undefined;
    }
  }

  /** Stores `session` and reads it back. A store that will not keep it leaves it held here alone. */
  async function save(session: ApiSession): Promise<void> {
    const value = JSON.stringify(session);
    try {
      await deps.store().set(value);
      storeKeeps = (await deps.store().get()) === value;
    } catch {
      storeKeeps = false;
    }
  }

  async function forget(): Promise<void> {
    try {
      await deps.store().remove();
    } catch {
      /* nothing more to do */
    }
  }

  /** Brings what is held into step with storage: another tab may have renewed the session, or dropped it. */
  async function inStep(): Promise<void> {
    if (!storeKeeps) return;
    const startedAt = dropped;
    const found = await stored();
    if (found === undefined || startedAt !== dropped) return;
    if (found?.accessToken !== held?.accessToken) held = found;
  }

  /**
   * `from` with its next tokens, or a new session when there is nothing to
   * renew, when it has run its time, or when its renewal is refused.
   */
  async function obtain(from: ApiSession | null): Promise<ApiSession> {
    if (from && !tooOld(from)) {
      try {
        return { ...(await deps.gateway().refresh(from.refreshToken)), startedAt: from.startedAt };
      } catch (error) {
        if (!(error instanceof SessionRefused)) throw error;
      }
    }
    return { ...(await deps.gateway().start()), startedAt: Date.now() };
  }

  function failed() {
    failures += 1;
    const pause = Math.min(SESSION_RETRY.capMs, SESSION_RETRY.firstMs * 2 ** (failures - 1));
    askAgainAt = Date.now() + pause * (1 + SESSION_RETRY.jitter * (deps.random ?? Math.random)());
  }

  function renewed(refused: string | null, startOver = false): Promise<ApiSession> {
    if (renewing) return renewing;
    const flight = deps
      .locks()
      .withLock(SESSION_LOCK, async () => {
        const startedAt = dropped;
        const found = storeKeeps ? await stored() : undefined;
        if (found && found.accessToken !== refused && fresh(found)) {
          if (startedAt === dropped) held = found;
          return found;
        }
        const next = await obtain(startOver ? null : found === undefined ? held : found);
        // Dropped while it was being had: it belongs to what was dropped, and is not kept.
        if (startedAt !== dropped) return next;
        held = next;
        await save(next);
        return next;
      })
      .then(
        (session) => {
          if (renewing === flight) [failures, askAgainAt] = [0, 0];
          return session;
        },
        (error: unknown) => {
          if (renewing === flight) failed();
          throw error;
        },
      )
      .finally(() => {
        if (renewing === flight) renewing = null;
      });
    renewing = flight;
    return flight;
  }

  const notAvailable = (cause?: unknown) => new ChainError("notAvailableNow", { cause });
  const pausing = () => renewing === null && Date.now() < askAgainAt;
  const stillGood = (session: ApiSession | null): session is ApiSession =>
    session !== null && held === session && !expired(session) && !tooOld(session);

  return {
    async token() {
      await inStep();
      const current = held;
      if (current && fresh(current)) return current.accessToken;
      try {
        if (pausing()) throw notAvailable();
        return (await renewed(null)).accessToken;
      } catch (error) {
        // Renewing early could not be asked for. The token held is still good for a while.
        if (stillGood(current)) return current.accessToken;
        throw error instanceof ChainError ? error : notAvailable(error);
      }
    },

    async renew(refused, startOver = false) {
      await inStep();
      if (held && held.accessToken !== refused && fresh(held)) return held.accessToken;
      if (pausing()) throw notAvailable();
      try {
        return (await renewed(refused, startOver)).accessToken;
      } catch (error) {
        throw notAvailable(error);
      }
    },

    async drop() {
      dropped += 1;
      held = null;
      storeKeeps = true;
      renewing = null;
      [failures, askAgainAt] = [0, 0];
      await deps.locks().withLock(SESSION_LOCK, forget);
    },
  };
}
