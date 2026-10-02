import type { UsageArgs, UsageEvent } from "./domain/usageEvents.js";

/**
 * The platform seam: everything that differs between the web app and the
 * mobile app, as small interfaces. Each app calls `installPlatform()` once at
 * boot, before any other code in this package runs.
 *
 * Cryptography and randomness are not here. Both platforms provide WebCrypto
 * on `globalThis.crypto`, and `assertRuntime()` checks that they do.
 */

export type VaultRead = { ok: true; value: string | null } | { ok: false };

/** What an update does with the value it was handed: write a new one (null removes it), or keep it. */
export type VaultChange = { write: string | null } | { keep: true };

export type VaultUpdate =
  | { persisted: true; value: string | null }
  /** `kept`: the change chose to keep the stored value, which is `value`. */
  | { persisted: false; reason: "kept"; value: string | null }
  /** `failed`: nothing was written, and what is stored is not known. */
  | { persisted: false; reason: "failed" };

/**
 * Where the device keeps what it must remember, sealed or not as the app
 * decides. Every call can fail, and says so rather than throwing.
 */
export interface VaultRepository {
  read(key: string): Promise<VaultRead>;
  /**
   * An atomic read-modify-write. `change` is handed the value as stored at
   * that moment and runs under the platform lock for `key`, so no other
   * update of `key`, from this context or another tab or process, can come
   * between its read and its write.
   */
  update(key: string, change: (current: string | null) => VaultChange): Promise<VaultUpdate>;
  /** Called with the key after any persisted change, from this context or another. Returns an unsubscribe. */
  subscribe(onChange: (key: string) => void): () => void;
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

/** Counts one usage event from the closed list in `domain/usageEvents.ts`. */
export type Track = <E extends UsageEvent>(event: E, ...props: UsageArgs<E>) => void;

/**
 * Runs one holder of `name` at a time. Across tabs on the web; within the
 * process on mobile, where `inProcessLocks()` is enough.
 */
export interface Locks {
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export interface Platform {
  vault: VaultRepository;
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
