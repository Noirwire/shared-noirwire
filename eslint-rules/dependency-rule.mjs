import { builtinModules } from "node:module";
import path from "node:path";

/**
 * The dependency rule, checked on where an import resolves to rather than on
 * how it is spelled. Each layer lists the layers it may import. `platform` is
 * src/platform.ts; every other layer is a folder under src/.
 *
 * `wallet` is where the keys live (sealing, derivation, the stored record and
 * its session) and where the catalog is bound to the price feeds. It is the
 * one layer that composes the others, and nothing imports it.
 */
export const MAY_IMPORT = {
  domain: [],
  design: [],
  platform: ["domain"],
  copy: ["domain"],
  application: ["domain", "platform"],
  infrastructure: ["domain", "application", "platform"],
  presentation: ["domain", "application", "copy"],
  wallet: ["domain", "application", "infrastructure", "presentation", "copy", "platform"],
  testing: ["platform", "infrastructure"],
};

const FRAMEWORK =
  /^(react|react-dom|react-native|next|expo|@expo|@react-native|@noirwire\/shared)($|[-/])|^@\//;
/**
 * `buffer` is the npm package of that name, which every Solana library
 * already imports, not Node's module: a bundler must see one implementation,
 * so it is imported by name.
 */
const NODE = new Set(builtinModules.filter((name) => name !== "buffer"));

function isNodeBuiltin(specifier) {
  return specifier.startsWith("node:") || NODE.has(specifier.split("/")[0]);
}

/** The layer a path inside `src` belongs to, or null for a path outside it. */
function layerOf(srcDir, file) {
  const relative = path.relative(srcDir, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [first, ...rest] = relative.split(path.sep);
  if (rest.length > 0) return first in MAY_IMPORT ? first : "unknown";
  return first.replace(/\.(js|ts)$/, "") === "platform" ? "platform" : "unknown";
}

function describe(layer) {
  const allowed = MAY_IMPORT[layer];
  return allowed.length ? allowed.join(", ") : "nothing of ours";
}

export const dependencyRule = {
  meta: {
    type: "problem",
    schema: [{ type: "object", properties: { srcDir: { type: "string" } }, required: ["srcDir"] }],
    messages: {
      layer: "Dependency rule: {{from}} may import {{allowed}}, not {{to}}. See README.md.",
      escape:
        "This import leaves the package's src/. Nothing here may depend on an app or on files outside the package.",
      outside:
        "This package is framework-free and is imported by the apps, never the reverse. What differs by platform goes through src/platform.ts.",
    },
  },
  create(context) {
    const { srcDir } = context.options[0];
    const from = layerOf(srcDir, context.filename);
    if (from === null || from === "unknown" || context.filename.endsWith(".test.ts")) return {};

    function check(node) {
      const specifier = node?.value;
      if (typeof specifier !== "string") return;
      if (!specifier.startsWith(".")) {
        if (FRAMEWORK.test(specifier) || isNodeBuiltin(specifier)) {
          context.report({ node, messageId: "outside" });
        }
        return;
      }
      const target = path.resolve(path.dirname(context.filename), specifier);
      const to = layerOf(srcDir, target);
      if (to === null || to === "unknown") {
        context.report({ node, messageId: "escape" });
      } else if (to !== from && !MAY_IMPORT[from].includes(to)) {
        context.report({ node, messageId: "layer", data: { from, to, allowed: describe(from) } });
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};
