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

/** The platform lock a renewal runs under, so two tabs never spend the same refresh token. */
export const SESSION_LOCK = "noirwire-session";

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
 * Callers that arrive together share one start or renewal, and it runs under
 * the platform lock, so another tab or process that got there first is found
 * in storage and used instead of spending the same refresh token twice. A
 * renewal the server refuses is followed by a new session. When no session
 * can be had at all, the failure is `notAvailableNow`.
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
}): SessionKeeper {
  let held: ApiSession | null = null;
  let renewing: Promise<ApiSession> | null = null;
  /** Moves on every drop, so a renewal that finishes after one is not kept. */
  let dropped = 0;

  const expired = (session: ApiSession) => session.expiresAt <= Date.now();
  const tooOld = (session: ApiSession) =>
    Date.now() - session.startedAt >= (deps.maxAgeMs?.() ?? SESSION_MAX_AGE_MS);
  const fresh = (session: ApiSession) =>
    !tooOld(session) && session.expiresAt - Date.now() > RENEW_BEFORE_EXPIRY_MS;

  async function stored(): Promise<ApiSession | null> {
    try {
      return parsed(await deps.store().get());
    } catch {
      return null;
    }
  }

  /** A store that will not take or give up the value is left at that: the session is still held here. */
  async function save(session: ApiSession): Promise<void> {
    try {
      await deps.store().set(JSON.stringify(session));
    } catch {
      /* kept in memory only */
    }
  }

  async function forget(): Promise<void> {
    try {
      await deps.store().remove();
    } catch {
      /* nothing more to do */
    }
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

  function renewed(refused: string | null, startOver = false): Promise<ApiSession> {
    if (renewing) return renewing;
    const flight = deps
      .locks()
      .withLock(SESSION_LOCK, async () => {
        const startedAt = dropped;
        const found = await stored();
        if (found && found.accessToken !== refused && fresh(found)) {
          if (startedAt === dropped) held = found;
          return found;
        }
        const next = await obtain(startOver ? null : (found ?? held));
        if (startedAt !== dropped) return next;
        held = next;
        await save(next);
        // Dropped while it was being written: what was just stored goes too.
        if (startedAt !== dropped) await forget();
        return next;
      })
      .finally(() => {
        if (renewing === flight) renewing = null;
      });
    renewing = flight;
    return flight;
  }

  const notAvailable = (cause: unknown) => new ChainError("notAvailableNow", { cause });

  return {
    async token() {
      const current = held;
      if (current && fresh(current)) return current.accessToken;
      try {
        return (await renewed(null)).accessToken;
      } catch (error) {
        // Renewing early could not be asked for. The token held is still good for a while.
        if (current && held === current && !expired(current) && !tooOld(current)) {
          return current.accessToken;
        }
        throw notAvailable(error);
      }
    },

    async renew(refused, startOver = false) {
      if (held && held.accessToken !== refused && fresh(held)) return held.accessToken;
      try {
        return (await renewed(refused, startOver)).accessToken;
      } catch (error) {
        throw notAvailable(error);
      }
    },

    async drop() {
      dropped += 1;
      held = null;
      renewing = null;
      await forget();
    },
  };
}
