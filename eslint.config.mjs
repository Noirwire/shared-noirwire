import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import path from "node:path";
import tseslint from "typescript-eslint";
import { dependencyRule } from "./eslint-rules/dependency-rule.mjs";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    // A bundler swaps a bare `Buffer` for its own polyfill, next to the
    // `buffer` package the Solana libraries import. Two implementations in
    // one bundle is how a check that passes in Node throws in an app.
    files: ["src/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Buffer", message: 'Import it (`import { Buffer } from "buffer"`).' },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    plugins: { noirwire: { rules: { "dependency-rule": dependencyRule } } },
    rules: {
      "noirwire/dependency-rule": ["error", { srcDir: path.join(import.meta.dirname, "src") }],
    },
  },
  globalIgnores(["dist/**", "coverage/**"]),
]);
