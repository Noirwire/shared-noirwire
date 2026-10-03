import { ESLint } from "eslint";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: ROOT });

/** Lints a one-import fixture as if it were saved at `file`, and returns what the dependency rule said. */
async function ruleMessages(file: string, specifier: string): Promise<string[]> {
  const fixture = `import { thing } from "${specifier}";\nexport const used = thing;\n`;
  const [result] = await eslint.lintText(fixture, { filePath: join(ROOT, file) });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "noirwire/dependency-rule")
    .map((message) => message.message);
}

type Fixture = [file: string, specifier: string, refusedLayer: string];

const LAYER_VIOLATIONS: Fixture[] = [
  ["src/domain/rule.ts", "../application/result.js", "application"],
  ["src/domain/rule.ts", "../copy/index.js", "copy"],
  ["src/domain/rule.ts", "../platform.js", "platform"],
  ["src/domain/nested/rule.ts", "../../infrastructure/rpc.js", "infrastructure"],
  ["src/design/tokens.ts", "../domain/format.js", "domain"],
  ["src/copy/send.ts", "../application/result.js", "application"],
  ["src/copy/send.ts", "../presentation/index.js", "presentation"],
  ["src/application/send.ts", "../copy/refusal.js", "copy"],
  ["src/application/send.ts", "../infrastructure/rpc.js", "infrastructure"],
  ["src/application/send.ts", "../presentation/networkCost.js", "presentation"],
  ["src/application/send.ts", "../testing/index.js", "testing"],
  ["src/infrastructure/rpc.ts", "../presentation/networkCost.js", "presentation"],
  ["src/infrastructure/rpc.ts", "../copy/index.js", "copy"],
  ["src/presentation/send.ts", "../infrastructure/rpc.js", "infrastructure"],
  ["src/presentation/send.ts", "../platform.js", "platform"],
  ["src/presentation/send.ts", "../design/tokens.js", "design"],
  ["src/testing/index.ts", "../application/pending.js", "application"],
  ["src/platform.ts", "./application/pending.js", "application"],
  ["src/infrastructure/rpc.ts", "../wallet/store.js", "wallet"],
  ["src/application/send.ts", "../wallet/store.js", "wallet"],
  ["src/presentation/send.ts", "../wallet/market.js", "wallet"],
  // The same targets, spelled so that a pattern on the text would miss them.
  ["src/domain/rule.ts", "./../application/result.js", "application"],
  ["src/domain/rule.ts", "../domain/../application/result.js", "application"],
  ["src/domain/rule.ts", "../../src/application/result.js", "application"],
  ["src/presentation/send.ts", "./../../src/infrastructure/rpc.js", "infrastructure"],
];

const ALLOWED: [file: string, specifier: string][] = [
  ["src/domain/rule.ts", "./format.js"],
  ["src/domain/nested/rule.ts", "../format.js"],
  ["src/domain/rule.ts", "../domain/format.js"],
  ["src/copy/send.ts", "../domain/format.js"],
  ["src/platform.ts", "./domain/usageEvents.js"],
  ["src/application/send.ts", "../domain/format.js"],
  ["src/application/send.ts", "../platform.js"],
  ["src/infrastructure/rpc.ts", "../application/pending.js"],
  ["src/infrastructure/rpc.ts", "../platform.js"],
  ["src/presentation/send.ts", "../application/result.js"],
  ["src/presentation/send.ts", "../copy/networkCost.js"],
  ["src/presentation/send.ts", "../domain/format.js"],
  ["src/testing/index.ts", "../platform.js"],
  ["src/testing/signing.ts", "../infrastructure/solana/signerAccounts.js"],
  ["src/application/send.ts", "@solana/web3.js"],
  ["src/infrastructure/rpc.ts", "buffer"],
  ["src/wallet/store.ts", "../infrastructure/solana/keys.js"],
  ["src/wallet/store.ts", "../platform.js"],
  ["src/wallet/amounts.ts", "../presentation/amount.js"],
];

const ESCAPES: [file: string, specifier: string][] = [
  ["src/domain/rule.ts", "../../../app-noirwire/src/lib/format"],
  ["src/presentation/send.ts", "../../../mobile-noirwire/src/ui/format"],
  ["src/application/send.ts", "../../tests/dependencyRule.test.js"],
  ["src/domain/rule.ts", "../../package.json"],
];

const FRAMEWORK: [file: string, specifier: string][] = [
  ["src/domain/rule.ts", "react"],
  ["src/presentation/send.ts", "react-native"],
  ["src/presentation/send.ts", "react-native-svg"],
  ["src/application/send.ts", "next/navigation"],
  ["src/application/send.ts", "expo-constants"],
  ["src/infrastructure/rpc.ts", "node:fs"],
  ["src/infrastructure/rpc.ts", "crypto"],
  ["src/domain/rule.ts", "@/lib/format"],
  ["src/presentation/send.ts", "@noirwire/shared/application"],
];

describe("the dependency rule", () => {
  it.each(LAYER_VIOLATIONS)("refuses %s importing %s (%s)", async (file, specifier, layer) => {
    const messages = await ruleMessages(file, specifier);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(new RegExp(`^Dependency rule: .*, not ${layer}\\.`));
  });

  it.each(ALLOWED)("allows %s importing %s", async (file, specifier) => {
    expect(await ruleMessages(file, specifier)).toEqual([]);
  });

  it.each(ESCAPES)("refuses %s importing %s from outside src", async (file, specifier) => {
    const messages = await ruleMessages(file, specifier);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("leaves the package's src/");
  });

  it.each(FRAMEWORK)("refuses %s importing %s", async (file, specifier) => {
    const messages = await ruleMessages(file, specifier);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("framework-free");
  });

  it("checks re-exports and dynamic imports as well", async () => {
    for (const fixture of [
      'export * from "../application/result.js";\n',
      'export { refused } from "../application/result.js";\n',
      'export const later = () => import("../application/result.js");\n',
    ]) {
      const [result] = await eslint.lintText(fixture, {
        filePath: join(ROOT, "src/domain/rule.ts"),
      });
      expect(result?.messages.map((message) => message.ruleId)).toEqual([
        "noirwire/dependency-rule",
      ]);
    }
  });
});

describe("the Buffer ban", () => {
  it("refuses the bare global in shared code", async () => {
    const [result] = await eslint.lintText("export const bytes = Buffer.alloc(8);\n", {
      filePath: join(ROOT, "src/domain/bytes.ts"),
    });
    expect(result?.messages.map((message) => message.ruleId)).toEqual(["no-restricted-globals"]);
  });
});

describe("the platform globals", () => {
  it.each(["navigator", "self", "location"])(
    "refuses %s, which a phone does not have",
    async (name) => {
      const [result] = await eslint.lintText(`export const here = ${name};\n`, {
        filePath: join(ROOT, "src/infrastructure/rpc.ts"),
      });
      expect(result?.messages.map((message) => message.ruleId)).toEqual(["no-restricted-globals"]);
    },
  );
});
