import { keepSessionWith, type SessionKeeper } from "../infrastructure/apiSession.js";
import {
  inProcessLocks,
  installPlatform,
  type Activity,
  type Env,
  type Locks,
  type Platform,
  type SessionStore,
  type Track,
  type VaultRepository,
} from "../platform.js";

/**
 * A vault in memory with the real contract: updates of one key are
 * serialised by the platform lock, every call can be made to fail, and
 * subscribers hear of every persisted change.
 */
export type MemoryVault = VaultRepository & {
  /** While true, every read and write fails as a broken store would. */
  unavailable: boolean;
  /** While true, reads work and every write fails, as a full or read-only store would. */
  refuseWrites: boolean;
  /** A change made by another tab or process. */
  writeFromElsewhere(key: string, value: string | null): void;
  /** The keys that hold a value, for a test to see what was stored. */
  keys(): string[];
  /** What is stored under `key`, read at once and outside the contract, for a test to inspect. */
  peek(key: string): string | null;
};

export function memoryVault(
  initial: Record<string, string> = {},
  locks: Locks = inProcessLocks(),
): MemoryVault {
  const items = new Map(Object.entries(initial));
  const listeners = new Set<(key: string) => void>();

  function store(key: string, value: string | null) {
    if (value === null) items.delete(key);
    else items.set(key, value);
    listeners.forEach((listener) => listener(key));
  }

  const vault: MemoryVault = {
    unavailable: false,
    refuseWrites: false,
    async read(key) {
      return vault.unavailable ? { ok: false } : { ok: true, value: items.get(key) ?? null };
    },
    update(key, change) {
      return locks.withLock(`vault:${key}`, async () => {
        if (vault.unavailable || vault.refuseWrites) {
          return { persisted: false, reason: "failed" } as const;
        }
        const current = items.get(key) ?? null;
        // A real store reads and writes asynchronously; this yield lets an
        // unserialised update interleave here, which the lock must prevent.
        await Promise.resolve();
        const decision = change(current);
        if ("keep" in decision)
          return { persisted: false, reason: "kept", value: current } as const;
        store(key, decision.write);
        return { persisted: true, value: decision.write } as const;
      });
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => void listeners.delete(onChange);
    },
    writeFromElsewhere: store,
    keys: () => [...items.keys()],
    peek: (key) => items.get(key) ?? null,
  };
  return vault;
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    network: "devnet",
    referralAccount: null,
    feeBps: 0,
    apiBaseUrl: TEST_API_URL,
    ...overrides,
  };
}

/** Where a test's requests are addressed. Nothing answers there: `fakeApi` does. */
export const TEST_API_URL = "https://api.noirwire.test";

/** A session store in memory, for tests: what is stored is on `value`. */
export function memorySessionStore(initial: string | null = null): SessionStore & {
  value: string | null;
} {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (next: string) => {
      store.value = next;
    },
    remove: async () => {
      store.value = null;
    },
  };
  return store;
}

export type FakeSession = SessionKeeper & {
  /** The token every request carries until the next renewal or drop. */
  current: string;
  /** How many times a new token was asked for after the server turned one down. */
  renewals: number;
  /** How many times the session was dropped. */
  drops: number;
};

/**
 * A session that asks nobody: its token is `test-token-1`, and each renewal
 * of that token, and each drop, moves it on to the next number. Install it with `keepSessionWith`,
 * or let `installTestPlatform` do so.
 */
export function fakeSession(): FakeSession {
  let issued = 1;
  const next = () => {
    issued += 1;
    session.current = `test-token-${issued}`;
  };
  const session: FakeSession = {
    current: "test-token-1",
    renewals: 0,
    drops: 0,
    token: async () => session.current,
    async renew(refused: string) {
      session.renewals += 1;
      if (refused === session.current) next();
      return session.current;
    },
    async drop() {
      session.drops += 1;
      next();
    },
  };
  return session;
}

/** An activity source a test drives by hand: `fire()` stands for a tap or a return to the app. */
export function manualActivity(): Activity & { fire(): void } {
  const listeners = new Set<() => void>();
  return {
    subscribe(onActive) {
      listeners.add(onActive);
      return () => void listeners.delete(onActive);
    },
    fire: () => listeners.forEach((listener) => listener()),
  };
}

export type TrackedEvent = { event: string; props?: object };

export function recordingTrack(): { track: Track; events: TrackedEvent[] } {
  const events: TrackedEvent[] = [];
  return {
    events,
    track: (event, ...props) => {
      events.push(props[0] ? { event, props: props[0] } : { event });
    },
  };
}

/** Every port, in memory. Pass the ones a test needs to inspect or drive. */
export function memoryPlatform(overrides: Partial<Platform> = {}): Platform {
  const locks = overrides.locks ?? inProcessLocks();
  return {
    vault: memoryVault({}, locks),
    env: testEnv(),
    activity: manualActivity(),
    track: recordingTrack().track,
    locks,
    sessionStore: memorySessionStore(),
    ...overrides,
  };
}

/**
 * Everything a consumer's test needs so that nothing reaches the network to
 * start with: every port in memory and a fake session in place of the
 * session routes. Hands back both, to inspect. Requests to the server itself are
 * answered with `fakeApi`.
 */
export function installTestPlatform(overrides: Partial<Platform> = {}): {
  platform: Platform;
  session: FakeSession;
} {
  const platform = memoryPlatform(overrides);
  const session = fakeSession();
  installPlatform(platform);
  keepSessionWith(session);
  return { platform, session };
}

export { type ApiCall, type ApiHandler, type FakeApi, fakeApi } from "./fakeApi.js";

export { signAsClient, unsignedTransaction } from "./signing.js";
