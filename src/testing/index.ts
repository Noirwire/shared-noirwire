import {
  inProcessLocks,
  type Activity,
  type Env,
  type Platform,
  type Relay,
  type Storage,
  type Track,
} from "../platform.js";

export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    keys: () => [...items.keys()],
  };
}

export function fixedRelay(baseUrl = "https://relay.test", headers = {}): Relay {
  return { baseUrl, headers: () => ({ ...headers }) };
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

export type TrackedEvent = { event: string; props?: Record<string, string | number | boolean> };

export function recordingTrack(): { track: Track; events: TrackedEvent[] } {
  const events: TrackedEvent[] = [];
  return {
    events,
    track: (event, props) => void events.push(props ? { event, props } : { event }),
  };
}

/** Every port, in memory. Pass the ones a test needs to inspect or drive. */
export function memoryPlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    storage: memoryStorage(),
    relay: fixedRelay(),
    env: testEnv(),
    activity: manualActivity(),
    track: recordingTrack().track,
    locks: inProcessLocks(),
    ...overrides,
  };
}
