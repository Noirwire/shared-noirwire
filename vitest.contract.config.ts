import { defineConfig } from "vitest/config";

/**
 * Contract tests: read-only calls against the real mainnet services this
 * package's code reads directly, checking that what they return still
 * matches what the code expects. Nothing is signed or sent.
 *
 * The shape of a live API is not knowable from its docs, and a response that
 * silently stopped matching is the one class of bug only mainnet can reveal,
 * so it is caught here for free, before it reaches a transaction that does
 * cost money. Separate from the unit suite because they need the network and
 * can fail for reasons that are not the code's fault.
 *
 * The checks that go through an app's relay routes live with that app.
 *
 * SOLANA_RPC_URL names a mainnet RPC (a dedicated provider: the public
 * endpoint rate-limits the suite partway through); JUPITER_API_KEY is
 * optional, and without it the suite paces itself.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/contract/**/*.test.ts"],
    setupFiles: ["tests/contract/setup/platform.ts"],
    env: {
      SOLANA_RPC_URL: process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com",
      JUPITER_API_KEY: process.env.JUPITER_API_KEY?.trim() || "",
    },
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
