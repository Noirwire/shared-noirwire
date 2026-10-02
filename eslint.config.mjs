import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * The dependency rule. Each layer lists the layers it may import; every
 * other layer is refused. `platform` is src/platform.ts, the rest are the
 * folders under src/.
 */
const MAY_IMPORT = {
  domain: [],
  design: [],
  platform: [],
  copy: ["domain"],
  application: ["domain", "platform", "copy"],
  infrastructure: ["domain", "application", "platform"],
  presentation: ["domain", "application", "copy"],
  testing: ["platform"],
};

const LAYERS = Object.keys(MAY_IMPORT);

/** Nothing here may depend on a framework, on Node, or on one of the apps. */
const OUTSIDE = {
  regex:
    "^(node:|react($|/)|react-dom($|/)|react-native($|[-/])|next($|/)|expo($|[-/])|@/)|(app|mobile)-noirwire",
  message:
    "This package is framework-free and is imported by the apps, never the reverse. What differs by platform goes through src/platform.ts.",
};

function layerRule(layer) {
  const refused = LAYERS.filter((other) => other !== layer && !MAY_IMPORT[layer].includes(other));
  const allowed = MAY_IMPORT[layer].length ? MAY_IMPORT[layer].join(", ") : "nothing of ours";
  return {
    files: [layer === "platform" ? "src/platform.ts" : `src/${layer}/**`],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            OUTSIDE,
            {
              regex: `^(\\.\\.?/)+(${refused.join("|")})(/|\\.js$|$)`,
              message: `Dependency rule: ${layer} may import ${allowed}. See README.md.`,
            },
          ],
        },
      ],
    },
  };
}

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
  ...LAYERS.map(layerRule),
  globalIgnores(["dist/**", "coverage/**"]),
]);
