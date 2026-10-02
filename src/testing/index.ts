import {
  inProcessLocks,
  type Activity,
  type Env,
  type Locks,
  type Platform,
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
  /** A change made by another tab or process. */
  writeFromElsewhere(key: string, value: string | null): void;
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
    async read(key) {
      return vault.unavailable ? { ok: false } : { ok: true, value: items.get(key) ?? null };
    },
    update(key, change) {
      return locks.withLock(`vault:${key}`, async () => {
        if (vault.unavailable) return { persisted: false, reason: "failed" } as const;
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
  };
  return vault;
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return { network: "devnet", referralAccount: null, feeBps: 0, ...overrides };
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
    ...overrides,
  };
}
