import { defineConfig } from "vitest/config";

/** Pure and deterministic: no network, no validator, plain Node. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
