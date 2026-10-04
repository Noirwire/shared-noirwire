/**
 * How long the app waits, as it opens, to learn which network it is
 * connected to. The same bounded wait as any other read: past it the app
 * says it cannot reach NoirWire and offers to try again, instead of showing
 * nothing while the read is asked for again and again.
 */
export const NETWORK_CHECK_LIMIT_MS = 8_000;

/** What the check found: the right network, another one, or no answer in time. */
export type NetworkCheck = "ok" | "wrongNetwork" | "unreachable";

/**
 * Asks which network the connection serves, by its genesis hash, and waits
 * no longer than `limitMs` for the answer. A read that fails and a read that
 * never answers are the same thing to the person waiting: `unreachable`.
 * The read itself is not stopped, only no longer waited for.
 */
export function checkNetwork(
  genesisHash: () => Promise<string>,
  expected: string,
  limitMs: number = NETWORK_CHECK_LIMIT_MS,
): Promise<NetworkCheck> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("unreachable"), limitMs);
    const settle = (check: NetworkCheck) => {
      clearTimeout(timer);
      resolve(check);
    };
    Promise.resolve()
      .then(genesisHash)
      .then(
        (hash) => settle(hash === expected ? "ok" : "wrongNetwork"),
        () => settle("unreachable"),
      );
  });
}
