import { defineConfig } from "vitest/config";

/**
 * Integration tests: real on-chain calls against a `solana-test-validator`
 * spun up for the run by tests/integration/global-setup.ts. Never points at
 * a public cluster. Needs `solana-test-validator` on the PATH.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup/env.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // Real transactions against a local validator (airdrops + confirmations)
    // are slower than unit tests; single-threaded to avoid airdrop/tx races.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
