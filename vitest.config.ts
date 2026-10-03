import { defineConfig } from "vitest/config";

/**
 * Unit tests: pure and deterministic, no network, no validator, plain Node.
 * See vitest.integration.config.ts for the on-chain suite and
 * vitest.contract.config.ts for the checks against live services.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/*.test.ts", "tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup/platform.ts"],
    // The dependency rule's suite starts ESLint, which takes seconds on a busy machine.
    testTimeout: 20_000,
  },
});
