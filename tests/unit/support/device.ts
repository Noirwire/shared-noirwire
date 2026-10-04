import { inProcessLocks, type Platform } from "../../../src/platform.js";
import {
  manualActivity,
  memoryPlatform,
  memorySessionStore,
  memoryVault,
} from "../../../src/testing/index.js";

/**
 * One device for the wallet store: an in-memory vault, the locks every tab on
 * it shares, and an activity source a test drives by hand. Each tab installs
 * `platform()` into its own freshly loaded copy of the package, so several
 * tabs are several module graphs over one vault, as in a browser.
 *
 * `localStorage` and `backing` read and write the vault directly, the way
 * another tab or a person with the device in hand would.
 */
export function fakeDevice() {
  const vault = memoryVault();
  const locks = inProcessLocks();
  const activity = manualActivity();
  const sessionStore = memorySessionStore();
  return {
    vault,
    activity,
    sessionStore,
    platform: (): Platform => memoryPlatform({ vault, locks, activity, sessionStore }),
    state: {
      get refuseWrites() {
        return vault.refuseWrites;
      },
      set refuseWrites(refuse: boolean) {
        vault.refuseWrites = refuse;
      },
    },
    localStorage: {
      getItem: (key: string) => vault.peek(key),
      setItem: (key: string, value: string) => vault.writeFromElsewhere(key, value),
      removeItem: (key: string) => vault.writeFromElsewhere(key, null),
    },
    backing: {
      has: (key: string) => vault.peek(key) !== null,
      keys: () => vault.keys(),
      get size() {
        return vault.keys().length;
      },
      clear: () => vault.keys().forEach((key) => vault.writeFromElsewhere(key, null)),
    },
  };
}

export type FakeDevice = ReturnType<typeof fakeDevice>;
