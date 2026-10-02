/**
 * The platform seam: everything that differs between the web app and the
 * mobile app, as small interfaces. Each app calls `installPlatform()` once at
 * boot, before any other code in this package runs.
 *
 * Cryptography and randomness are not here. Both platforms provide WebCrypto
 * on `globalThis.crypto`, and `assertRuntime()` checks that they do.
 */

/** A synchronous key-value store, the shape of the browser's localStorage. */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

/**
 * Where relayed requests go. Same-origin on the web, so `baseUrl` is empty
 * there; an absolute URL plus a header naming the client on mobile.
 */
export interface Relay {
  baseUrl: string;
  headers(): Record<string, string>;
}

export interface Env {
  network: "mainnet-beta" | "devnet";
  /** The account trade fees are paid to, or null where none is set. */
  referralAccount: string | null;
  feeBps: number;
}

/** User input and return-to-foreground events, which the idle lock counts from. */
export interface Activity {
  subscribe(onActive: () => void): () => void;
}

export type Track = (event: string, props?: Record<string, string | number | boolean>) => void;

/**
 * Runs one holder of `name` at a time. Across tabs on the web; within the
 * process on mobile, where `inProcessLocks()` is enough.
 */
export interface Locks {
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export interface Platform {
  storage: Storage;
  relay: Relay;
  env: Env;
  activity: Activity;
  track: Track;
  locks: Locks;
}

let installed: Platform | null = null;

export function installPlatform(platform: Platform): void {
  installed = platform;
}

export function getPlatform(): Platform {
  if (!installed) {
    throw new Error(
      "@noirwire/shared: no platform installed. Call installPlatform() once at app boot, before using the package.",
    );
  }
  return installed;
}

export function inProcessLocks(): Locks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    withLock(name, fn) {
      const run = (tails.get(name) ?? Promise.resolve()).then(fn);
      const tail = run.catch(() => undefined);
      tails.set(name, tail);
      void tail.then(() => {
        if (tails.get(name) === tail) tails.delete(name);
      });
      return run;
    },
  };
}

type RuntimeGlobals = {
  crypto?: { subtle?: unknown; getRandomValues?: unknown };
  TextEncoder?: unknown;
  TextDecoder?: unknown;
};

/**
 * Checks that the runtime has what this package's cryptography stands on, so
 * a missing polyfill stops the app at boot and not in the middle of sealing a
 * wallet.
 */
export function assertRuntime(runtime: RuntimeGlobals = globalThis as RuntimeGlobals): void {
  const missing = [
    !runtime.crypto?.subtle && "crypto.subtle",
    typeof runtime.crypto?.getRandomValues !== "function" && "crypto.getRandomValues",
    typeof runtime.TextEncoder !== "function" && "TextEncoder",
    typeof runtime.TextDecoder !== "function" && "TextDecoder",
  ].filter((name) => name !== false);
  if (missing.length > 0) {
    throw new Error(`@noirwire/shared: this runtime is missing ${missing.join(", ")}.`);
  }
}
