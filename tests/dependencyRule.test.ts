import { ESLint } from "eslint";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: ROOT });

/** Lints a one-import fixture as if it were saved at `file`, and returns what the import rule said. */
async function importErrors(file: string, specifier: string): Promise<string[]> {
  const fixture = `import { thing } from "${specifier}";\nexport const used = thing;\n`;
  const [result] = await eslint.lintText(fixture, { filePath: join(ROOT, file) });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

const VIOLATIONS: [file: string, specifier: string][] = [
  ["src/domain/rule.ts", "../application/result.js"],
  ["src/domain/rule.ts", "../copy/index.js"],
  ["src/domain/rule.ts", "../platform.js"],
  ["src/domain/nested/rule.ts", "../../infrastructure/rpc.js"],
  ["src/design/tokens.ts", "../domain/format.js"],
  ["src/copy/send.ts", "../application/result.js"],
  ["src/copy/send.ts", "../presentation/index.js"],
  ["src/application/send.ts", "../infrastructure/rpc.js"],
  ["src/application/send.ts", "../presentation/networkCost.js"],
  ["src/application/send.ts", "../testing/index.js"],
  ["src/infrastructure/rpc.ts", "../presentation/networkCost.js"],
  ["src/infrastructure/rpc.ts", "../copy/index.js"],
  ["src/presentation/send.ts", "../infrastructure/rpc.js"],
  ["src/presentation/send.ts", "../platform.js"],
  ["src/presentation/send.ts", "../design/tokens.js"],
  ["src/testing/index.ts", "../application/pending.js"],
  ["src/platform.ts", "./domain/format.js"],
];

const ALLOWED: [file: string, specifier: string][] = [
  ["src/domain/rule.ts", "./format.js"],
  ["src/domain/nested/rule.ts", "../format.js"],
  ["src/copy/send.ts", "../domain/format.js"],
  ["src/application/send.ts", "../domain/format.js"],
  ["src/application/send.ts", "../platform.js"],
  ["src/application/send.ts", "../copy/refusal.js"],
  ["src/infrastructure/rpc.ts", "../application/pending.js"],
  ["src/infrastructure/rpc.ts", "../platform.js"],
  ["src/presentation/send.ts", "../application/result.js"],
  ["src/presentation/send.ts", "../copy/networkCost.js"],
  ["src/presentation/send.ts", "../domain/format.js"],
  ["src/testing/index.ts", "../platform.js"],
];

const OUTSIDE: [file: string, specifier: string][] = [
  ["src/domain/rule.ts", "react"],
  ["src/presentation/send.ts", "react-native"],
  ["src/application/send.ts", "next/navigation"],
  ["src/infrastructure/rpc.ts", "node:fs"],
  ["src/application/send.ts", "expo-constants"],
  ["src/domain/rule.ts", "../../../app-noirwire/src/lib/format"],
  ["src/domain/rule.ts", "@/lib/format"],
];

describe("the dependency rule", () => {
  it.each(VIOLATIONS)("refuses %s importing %s", async (file, specifier) => {
    const errors = await importErrors(file, specifier);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Dependency rule");
  });

  it.each(ALLOWED)("allows %s importing %s", async (file, specifier) => {
    expect(await importErrors(file, specifier)).toEqual([]);
  });

  it.each(OUTSIDE)("refuses %s importing %s", async (file, specifier) => {
    const errors = await importErrors(file, specifier);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("framework-free");
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
