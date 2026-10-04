import { defineConfig } from "vitest/config";

/**
 * This package's clients against a running copy of NoirWire's server, read
 * paths only: a session, prices, a chart, one RPC read, the relayer's keys.
 * Nothing is signed or sent. Runs only when NOIRWIRE_API_URL names the
 * server, such as http://localhost:4000 for one started from its own
 * repository; skipped, with a line saying so, otherwise.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/api/live.test.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
